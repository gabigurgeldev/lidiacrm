/**
 * Flow Engine — a casca de I/O: `FlowAdminClient` e as portas, sobre Supabase.
 *
 * Tudo que o motor e os nós NÃO sabem fazer mora aqui. É o único arquivo do
 * módulo que conhece nome de tabela.
 *
 * ⚠️ Usa o cliente ADMIN, que passa por cima da RLS. Por isso toda consulta
 * filtra `organization_id` explicitamente — a regra nº 10 dos anti-patterns do
 * repo. A org vem sempre da linha da execução, nunca de entrada externa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { desfechoDoEnvio, type MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import { ensureConversation, sessaoProntaParaEnvio } from "@/lib/automation/start-conversation";
import { criarDisparo } from "@/lib/bulk-send/criar-disparo";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { logger } from "@/lib/logger";
import { selectFixedOrder } from "@/lib/routing/decide";
import type { RoutingCandidate } from "@/lib/routing/decide";
import { loadEligibleAttendants } from "@/lib/routing/eligibles";

import { EVENTO_DE_SUBFLUXO } from "./engine";
import type {
  FlowAdminClient,
  FlowExecutionPatch,
  FlowExecutionRow,
  PortasDaExecucao,
} from "./engine";
import type { EncontroRow, FrenteNova, FrenteRow } from "./frentes";
import type {
  DesfechoDeEnvio,
  DesfechoDoDisparo,
  EsperaEmCurso,
  FatosDaExecucao,
  PedidoDeDisparo,
  TipoDeMensagemDoFluxo,
} from "./types";

/** Marca do contato criado só para avisar alguém da equipe. */
export const ORIGEM_DO_CONTATO_INTERNO = "flow_engine:aviso_interno";

export function criarFlowAdminClient(admin: SupabaseClient): FlowAdminClient {
  return {
    async reclamarVencidas(limite, leaseSegundos) {
      const { data, error } = await admin.rpc("fn_claim_due_flow_executions", {
        p_limit: limite,
        p_lease_seconds: leaseSegundos,
      });
      // Lança de propósito: o motor traduz em `claim_falhou`, que é o que separa
      // "a RPC caiu" de "não havia nada vencido". Engolir aqui apagaria a
      // diferença para sempre.
      if (error) throw new Error(error.message);
      return (data ?? []) as FlowExecutionRow[];
    },

    async carregarGrafo(orgId, versionId) {
      const { data } = await admin
        .from("flow_versions")
        .select("graph")
        .eq("organization_id", orgId)
        .eq("id", versionId)
        .maybeSingle();
      return (data as { graph: unknown } | null)?.graph ?? null;
    },

    async carregarFatos(orgId, exec) {
      return carregarFatos(admin, orgId, exec);
    },

    async esperaEmCurso(executionId, nodeId) {
      // O ÚLTIMO passo daquele nó decide. Se for `espera_iniciada`, a espera
      // está de pé; se for `no_avancou`, ela já terminou numa visita anterior.
      // Buscar só por `espera_iniciada` faria uma segunda visita ao mesmo nó
      // (a redistribuição volta ao rodízio) achar a espera VELHA e pular a nova.
      const { data } = await admin
        .from("flow_execution_events")
        .select("event_type, payload, created_at")
        .eq("execution_id", executionId)
        .eq("node_id", nodeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const linha = data as
        | { event_type: string; payload: Record<string, unknown>; created_at: string }
        | null;
      // Duas formas de esperar, e as duas contam: `espera_iniciada` é a espera
      // por RELÓGIO (`logic.wait`), `espera_por_evento` é a espera por algo
      // ACONTECER (`logic.await_event`). Reconhecer só a primeira faria o bloco
      // de espera por evento nunca saber que já esperou — ele reagendaria um
      // prazo novo a cada volta, para sempre, e a saída "Aconteceu" nunca seria
      // percorrida.
      const ESPERAS = ["espera_iniciada", "espera_por_evento"];
      if (linha === null || !ESPERAS.includes(linha.event_type)) return null;
      const ate = typeof linha.payload.ate === "string" ? Date.parse(linha.payload.ate) : NaN;
      if (Number.isNaN(ate)) return null;
      return { desde: new Date(linha.created_at), ate: new Date(ate) } satisfies EsperaEmCurso;
    },

    async registrarPasso(evento) {
      const { error } = await admin.from("flow_execution_events").insert(evento);
      if (error === null) return { inserted: true };
      // 23505 = a chave de idempotência já existia. É replay, não defeito.
      if ((error as { code?: string }).code === "23505") return { inserted: false };
      throw new Error(error.message);
    },

    async atualizarExecucao(id, orgId, patch: FlowExecutionPatch) {
      const { error } = await admin
        .from("flow_executions")
        .update({ ...patch, updated_at: patch.updated_at ?? new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },

    async nomeDoFluxo(orgId, flowId) {
      const { data } = await admin
        .from("flows")
        .select("name")
        .eq("organization_id", orgId)
        .eq("id", flowId)
        .maybeSingle();
      return (data as { name: string } | null)?.name ?? null;
    },

    async abrirAvisoDeMorte(item) {
      await abrirAviso(admin, {
        organizationId: item.organization_id,
        titulo: item.titulo,
        corpo: item.corpo,
        severidade: "critical",
        refId: item.refId,
      });
    },

    // ─────────────────────── o que o paralelo acrescenta ───────────────────────

    async frentesProntas(exec) {
      const { data, error } = await admin
        .from("flow_execution_frames")
        .select("*")
        .eq("organization_id", exec.organization_id)
        .eq("execution_id", exec.id)
        // Viva E vencida. Filtrar so por 'ready' deixaria toda frente que
        // dormiu num `wait` presa para sempre: o relogio dela vence, o claim
        // traz a execucao de volta, e nada aqui a devolveria para o motor.
        .in("status", ["ready", "waiting"])
        .lte("next_eval_at", new Date().toISOString())
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const prontas = (data ?? []) as FrenteRow[];
      if (prontas.length > 0) return prontas;

      // Nenhuma frente PRONTA. Ou a execução tem frentes dormindo — e aí não há
      // o que caminhar —, ou ela é anterior a esta tabela e nunca teve nenhuma.
      const { count, error: erroConta } = await admin
        .from("flow_execution_frames")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", exec.organization_id)
        .eq("execution_id", exec.id);
      if (erroConta) throw new Error(erroConta.message);
      if ((count ?? 0) > 0) return [];

      // ⚠️ A AUTO-CURA DA RAIZ é o que faz o paralelo entrar sem backfill.
      //
      // Toda execução que já estava em voo quando esta tabela nasceu não tem
      // frente nenhuma, e o estado dela é exatamente `current_node_id` +
      // `steps_taken`. Sem esta cura, ou toda execução viva morreria no primeiro
      // tick pós-deploy, ou o self-hoster teria de rodar um backfill à mão — e a
      // doutrina de packaging proíbe uma atualização que peça isso.
      const raiz = await criarFrentes(admin, [
        {
          organization_id: exec.organization_id,
          execution_id: exec.id,
          parent_frame_id: null,
          node_id: exec.current_node_id,
          status: "ready",
          next_eval_at: new Date().toISOString(),
          steps_taken: exec.steps_taken,
          vars: {},
          fork_node_id: null,
        },
      ]);
      return raiz;
    },

    async criarFrentes(frentes) {
      return criarFrentes(admin, frentes);
    },

    async atualizarFrente(id, orgId, patch) {
      const { error } = await admin
        .from("flow_execution_frames")
        .update({ ...patch, updated_at: patch.updated_at ?? new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },

    async frentesVivas(executionId, orgId) {
      const { count, error } = await admin
        .from("flow_execution_frames")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("execution_id", executionId)
        .in("status", ["ready", "waiting"]);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async relerFrente(id, orgId) {
      const { data, error } = await admin
        .from("flow_execution_frames")
        .select("*")
        .eq("organization_id", orgId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as FrenteRow | null) ?? null;
    },

    async relogioDasFrentesVivas(executionId, orgId) {
      const { data, error } = await admin
        .from("flow_execution_frames")
        .select("next_eval_at")
        .eq("organization_id", orgId)
        .eq("execution_id", executionId)
        .in("status", ["ready", "waiting"])
        .not("next_eval_at", "is", null)
        .order("next_eval_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      return ((data ?? [])[0] as { next_eval_at: string } | undefined)?.next_eval_at ?? null;
    },

    async abrirEncontro(encontro) {
      // `onConflict` no par (execution_id, fork_node_id) é o que torna o fork
      // idempotente: o motor pode revisitar o nó de fork num retry, e o encontro
      // não pode nascer duas vezes nem ter a contagem zerada por isso.
      const { error } = await admin
        .from("flow_execution_joins")
        .upsert(encontro, { onConflict: "execution_id,fork_node_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },

    async chegarNoEncontroSePreciso(input) {
      const { data, error } = await admin.rpc("fn_flow_join_arrive", {
        p_org: input.organization_id,
        p_exec: input.execution_id,
        p_fork: input.fork_node_id,
        p_node: input.node_id,
      });
      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as EncontroRow[];
      // Zero linhas = a frente não está no nó de encontro daquele fork. É o caso
      // comum, e é por isso que a pergunta e a contagem são a mesma viagem.
      return linhas[0] ?? null;
    },

    async resolverEncontro(input) {
      const { error } = await admin
        .from("flow_execution_joins")
        .update({ resolvido_em: input.em })
        .eq("organization_id", input.organization_id)
        .eq("execution_id", input.execution_id)
        .eq("fork_node_id", input.fork_node_id)
        // Só grava se ainda era nulo: quem resolveu primeiro é quem vale, e um
        // retry não pode reescrever o instante da decisão.
        .is("resolvido_em", null);
      if (error) throw new Error(error.message);
    },

    async cancelarFrentesIrmas(input) {
      const { error } = await admin
        .from("flow_execution_frames")
        .update({
          status: "cancelled",
          // Cancelada é terminal, e terminal não tem relógio — é o que o CHECK
          // `flow_execution_frames_clock_check` cobra. Deixar o relógio faria a
          // perdedora ser reclamada de novo, para andar depois de ter perdido.
          next_eval_at: null,
          claimed_until: null,
          awaiting_event_type: null,
          awaiting_match: null,
          wait_deadline: null,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", input.organization_id)
        .eq("execution_id", input.execution_id)
        .eq("fork_node_id", input.fork_node_id)
        .neq("id", input.excetoFrenteId)
        .in("status", ["ready", "waiting"]);
      if (error) throw new Error(error.message);
    },

    async carregarGlobais(orgId) {
      const { data } = await admin
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .maybeSingle();
      const settings = (data as { settings: Record<string, unknown> | null } | null)?.settings;
      const globais = (settings ?? {})["flow_globals"];
      // Objeto ou nada. Um `flow_globals` que alguém gravou como string ou lista
      // viraria `{{global.x}}` indefinido em silêncio; devolver `{}` é o mesmo
      // resultado, mas sem fingir que leu algo.
      return globais !== null && typeof globais === "object" && !Array.isArray(globais)
        ? (globais as Record<string, unknown>)
        : {};
    },

    async avisarQueSubFluxoTerminou(input) {
      // Vai pelo `event_log` como todo o resto: trigger do Postgres não faz
      // HTTP e não acorda ninguém, então quem reage a algo neste produto é
      // sempre um handler do barramento. O acordador escuta este tipo.
      const { error } = await admin.from("event_log").insert({
        organization_id: input.organization_id,
        event_type: EVENTO_DE_SUBFLUXO,
        entity_kind: "flow_execution",
        entity_id: input.execution_id,
        payload: {
          // `execution_id` é o que o `match` da frente do pai compara — é assim
          // que o aviso chega a QUEM chamou, e não a toda frente que por acaso
          // espera um sub-fluxo.
          execution_id: input.execution_id,
          parent_execution_id: input.parent_execution_id,
          outcome: input.outcome,
          output: input.output,
        },
      });
      if (error) throw new Error(error.message);
    },

    async chamarSubFluxo(input) {
      // A versão PUBLICADA é a que roda. Chamar um fluxo em rascunho faria o
      // sub-fluxo mudar debaixo de quem o chama, a cada salvamento do editor.
      const { data: fluxo } = await admin
        .from("flows")
        .select("id, published_version_id")
        .eq("organization_id", input.organization_id)
        .eq("id", input.flow_id)
        .maybeSingle();
      const versao = (fluxo as { published_version_id: string | null } | null)?.published_version_id;
      if (!versao) return null;

      const { data: grafo } = await admin
        .from("flow_versions")
        .select("graph")
        .eq("organization_id", input.organization_id)
        .eq("id", versao)
        .maybeSingle();
      const nos = ((grafo as { graph: { nodes?: { id: string; type: string }[] } } | null)?.graph
        ?.nodes ?? []) as { id: string; type: string }[];
      const entrada = nos.find((n) => n.type.startsWith("trigger."));
      if (entrada === undefined) return null;

      const agora = new Date().toISOString();
      const { data: filha, error } = await admin
        .from("flow_executions")
        .insert({
          organization_id: input.organization_id,
          flow_id: input.flow_id,
          version_id: versao,
          status: "pending",
          current_node_id: entrada.id,
          next_eval_at: agora,
          attempts: 0,
          steps_taken: 0,
          context: {},
          input: input.input,
          output: {},
          parent_execution_id: input.parent_execution_id,
          parent_frame_id: input.parent_frame_id,
          lead_id: input.lead_id,
          contact_id: input.contact_id,
          conversation_id: input.conversation_id,
          started_at: agora,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { execution_id: (filha as { id: string }).id };
    },
  };
}

/** O INSERT das frentes, num lugar so: a auto-cura da raiz usa o mesmo. */
async function criarFrentes(
  admin: SupabaseClient,
  frentes: FrenteNova[],
): Promise<FrenteRow[]> {
  if (frentes.length === 0) return [];
  const { data, error } = await admin.from("flow_execution_frames").insert(frentes).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as FrenteRow[];
}

// ───────────────────────────────── fatos ─────────────────────────────────────

async function carregarFatos(
  admin: SupabaseClient,
  orgId: string,
  exec: FlowExecutionRow,
): Promise<FatosDaExecucao> {
  let lead: FatosDaExecucao["lead"] = null;
  let contactId = exec.contact_id;

  if (exec.lead_id !== null) {
    const { data } = await admin
      .from("crm_leads")
      .select(
        "id, title, status, stage_id, pipeline_id, owner_user_id, value_cents, source, tags, custom_fields, contact_id, created_at",
      )
      .eq("organization_id", orgId)
      .eq("id", exec.lead_id)
      .maybeSingle();
    const l = data as Record<string, unknown> | null;
    if (l !== null) {
      // O score vive em `crm_lead_scores`, FORA de `crm_leads` — e a linha pode
      // não existir: só é escrita por `recalculaScoreDoLead`, a partir do turno
      // de conversa. Lead recém-criado chega aqui SEM score, e `null` é a
      // resposta honesta (ver a regra de ausência em `condicoes.ts`).
      const { data: sc } = await admin
        .from("crm_lead_scores")
        .select("ai_probability, ai_probability_band")
        .eq("organization_id", orgId)
        .eq("lead_id", exec.lead_id)
        .maybeSingle();
      const s = sc as { ai_probability: number | null; ai_probability_band: string | null } | null;
      lead = {
        id: String(l.id),
        title: String(l.title ?? ""),
        status: String(l.status ?? "open"),
        stage_id: String(l.stage_id ?? ""),
        pipeline_id: String(l.pipeline_id ?? ""),
        owner_user_id: (l.owner_user_id as string | null) ?? null,
        value_cents: (l.value_cents as number | null) ?? null,
        source: String(l.source ?? "manual"),
        tags: Array.isArray(l.tags) ? (l.tags as string[]) : [],
        custom_fields: (l.custom_fields as Record<string, unknown> | null) ?? {},
        score: s?.ai_probability ?? null,
        score_band: s?.ai_probability_band ?? null,
        created_at: String(l.created_at ?? ""),
      };
      contactId = contactId ?? ((l.contact_id as string | null) ?? null);
    }
  }

  let contact: FatosDaExecucao["contact"] = null;
  if (contactId !== null) {
    const { data } = await admin
      .from("contacts")
      .select("id, name, display_name, phone_number, email, tags, is_blocked")
      .eq("organization_id", orgId)
      .eq("id", contactId)
      .maybeSingle();
    const c = data as Record<string, unknown> | null;
    if (c !== null) {
      contact = {
        id: String(c.id),
        name: (c.display_name as string | null) ?? (c.name as string | null) ?? null,
        phone_number: (c.phone_number as string | null) ?? null,
        email: (c.email as string | null) ?? null,
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        is_blocked: c.is_blocked === true,
      };
    }
  }

  const assigned_user = await carregarDono(admin, orgId, lead?.owner_user_id ?? null);
  return { lead, contact, assigned_user };
}

async function carregarDono(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
): Promise<FatosDaExecucao["assigned_user"]> {
  if (userId === null) return null;
  const { data } = await admin
    .from("attendant_availability")
    .select("user_id, notification_phone")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  const a = data as { user_id: string; notification_phone: string | null } | null;

  // O nome do atendente NÃO está em tabela: vem do GoTrue. Uma falha aqui não
  // pode derrubar a execução — o nome é enfeite da mensagem, o telefone é o que
  // decide se o aviso sai.
  let nome: string | null = null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const meta = u?.user?.user_metadata as { full_name?: unknown } | undefined;
    nome = typeof meta?.full_name === "string" ? meta.full_name : null;
  } catch {
    nome = null;
  }

  return { id: userId, name: nome, notification_phone: a?.notification_phone ?? null };
}

// ───────────────────────────────── portas ────────────────────────────────────

export function criarPortas(
  admin: SupabaseClient,
  exec: FlowExecutionRow,
  agora: () => Date = () => new Date(),
): PortasDaExecucao {
  const orgId = exec.organization_id;

  return {
    crm: {
      async atribuirDono({ leadId, userId }) {
        const { error } = await admin
          .from("crm_leads")
          .update({
            owner_user_id: userId,
            owner_kind: "user",
            assigned_at: agora().toISOString(),
            updated_at: agora().toISOString(),
          })
          .eq("organization_id", orgId)
          .eq("id", leadId);
        if (error) throw new Error(error.message);
      },

      async removerDono({ leadId }) {
        const { error } = await admin
          .from("crm_leads")
          .update({ owner_user_id: null, assigned_at: null, updated_at: agora().toISOString() })
          .eq("organization_id", orgId)
          .eq("id", leadId);
        if (error) throw new Error(error.message);
      },

      async adicionarTag({ leadId, tag }) {
        // Lê-modifica-escreve porque o PostgREST não expõe `array_append`. A
        // corrida possível (duas execuções marcando o mesmo lead no mesmo
        // instante) perde uma tag, e não corrompe nada; uma RPC nova para isto
        // custaria mais uma `security definer` a revogar das duas origens.
        const { data } = await admin
          .from("crm_leads")
          .select("tags")
          .eq("organization_id", orgId)
          .eq("id", leadId)
          .maybeSingle();
        const atuais = Array.isArray((data as { tags?: unknown } | null)?.tags)
          ? ((data as { tags: string[] }).tags)
          : [];
        if (atuais.includes(tag)) return;
        const { error } = await admin
          .from("crm_leads")
          .update({ tags: [...atuais, tag], updated_at: agora().toISOString() })
          .eq("organization_id", orgId)
          .eq("id", leadId);
        if (error) throw new Error(error.message);
      },

      async houveRespostaDoDono({ leadId, desde }) {
        // "Respondeu" = saiu mensagem PARA O LEAD depois de `desde`, mandada por
        // uma pessoa. `sent_via='ai'` não conta: se a IA respondeu, o vendedor
        // não atendeu — e é justamente esse caso que o fluxo quer redistribuir.
        const { data: l } = await admin
          .from("crm_leads")
          .select("contact_id")
          .eq("organization_id", orgId)
          .eq("id", leadId)
          .maybeSingle();
        const contactId = (l as { contact_id: string | null } | null)?.contact_id ?? null;
        if (contactId === null) return false;

        const { count } = await admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("contact_id", contactId)
          .eq("direction", "outbound")
          .in("sent_via", ["crm", "user", "external_device"])
          .gte("created_at", desde);
        return (count ?? 0) > 0;
      },

      async devolverAoAgente({ contactId }) {
        return devolverAoAgenteDoFluxo(admin, orgId, { contactId, exec });
      },
    },

    roteamento: {
      async elegiveis({ organizationId }) {
        return loadEligibleAttendants(admin, organizationId, agora());
      },

      async proximoDaFilaFixa({ nodeId, ordem, elegiveis }) {
        return proximoDaFilaFixaNoBanco(admin, orgId, { exec, nodeId, ordem, elegiveis });
      },
    },

    canal: {
      async enviarTexto({ telefone, texto, interno }) {
        return enviarTextoParaTelefone(admin, orgId, { telefone, texto, interno, exec });
      },

      async enviarParaContato({ contactId, tipo, texto, mediaUrl, channelSessionId }) {
        return enviarParaContatoDoFunil(admin, orgId, {
          contactId,
          tipo,
          texto,
          mediaUrl,
          channelSessionId,
          exec,
        });
      },
    },

    disparo: {
      async criar(pedido) {
        return criarDisparoDoFluxo(admin, orgId, { pedido, exec });
      },
    },

    avisos: {
      async abrir({ titulo, corpo, severidade, refId }) {
        await abrirAviso(admin, { organizationId: orgId, titulo, corpo, severidade, refId });
      },
    },
  };
}

// ──────────────────────── a vez da fila indiana ──────────────────────────────

/**
 * Quem, na ordem declarada, atende agora.
 *
 * A posição vem da RPC `fn_flow_routing_next_in_order`, que avança o cursor sob
 * o lock da linha e devolve a vez. Ler e gravar daqui em duas idas seria
 * corrida: dois leads no mesmo tique leriam a MESMA posição e o segundo
 * entregaria ao mesmo vendedor — a fila para de andar exatamente quando há
 * movimento, que é quando ninguém está olhando.
 *
 * Se a RPC falhar, a fila NÃO trava o fluxo: cai para a primeira pessoa
 * elegível da ordem. Perder a vez uma vez é melhor que segurar o lead.
 */
async function proximoDaFilaFixaNoBanco(
  admin: SupabaseClient,
  orgId: string,
  input: {
    exec: FlowExecutionRow;
    nodeId: string;
    ordem: readonly string[];
    elegiveis: readonly string[];
  },
): Promise<{ userId: string | null; avancou: number }> {
  const elegiveis = input.elegiveis.map((userId) => ({ userId }) as RoutingCandidate);

  let cursor = 0;
  const { data, error } = await admin.rpc("fn_flow_routing_next_in_order", {
    p_organization_id: orgId,
    p_flow_id: input.exec.flow_id,
    p_node_id: input.nodeId,
    p_tamanho: input.ordem.length,
  });
  if (error === null && typeof data === "number") {
    cursor = data;
  } else if (error !== null) {
    logger.warn("[flow.fila_indiana] cursor indisponivel, comecando do inicio da ordem", {
      erro: error.message,
    });
  }

  const escolha = selectFixedOrder(input.ordem, elegiveis, cursor);
  return { userId: escolha.userId, avancou: cursor };
}

// ──────────────────── devolver o atendimento à IA ────────────────────────────

/**
 * A conversa deste contato volta para o agente.
 *
 * Passa por `devolverAtendimentoAoAgente`, a MESMA função do botão da tela. O
 * cabeçalho dela conta por quê: a passagem para humano tem três travas, e a
 * versão anterior daquela rota soltava só a mais fraca — respondia sucesso e
 * deixava o agente mudo para sempre.
 */
async function devolverAoAgenteDoFluxo(
  admin: SupabaseClient,
  orgId: string,
  input: { contactId: string; exec: FlowExecutionRow },
): Promise<{ ok: true; jaEstavaComOAgente: boolean } | { ok: false; motivo: string }> {
  const { data } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", input.contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const conversationId = (data as { id: string } | null)?.id ?? null;
  if (conversationId === null) return { ok: false, motivo: "sem_conversa" };

  const r = await devolverAtendimentoAoAgente(
    {
      supabase: admin,
      organizationId: orgId,
      // Mesmo ator que o envio do motor usa — a trilha diz que quem agiu foi o
      // fluxo, e qual.
      actor: { type: "webhook_source", id: input.exec.flow_id },
      requestId: `flow:${input.exec.id}`,
    },
    { conversationId },
  );

  if (!r.ok) return { ok: false, motivo: r.erro };
  return { ok: true, jaEstavaComOAgente: r.jaEstavaComOAgente };
}

// ─────────────────────────── disparo em massa ────────────────────────────────

/**
 * Cria a campanha pelo MESMO caminho da tela.
 *
 * A tradução entre o formato do bloco (plano, porque o gerador de fluxo por IA
 * recusa união discriminada) e o da rota (`CriarDisparoInput`, que tem a união)
 * acontece aqui, num lugar só.
 *
 * ⚠️ `organizationId` vem da LINHA DA EXECUÇÃO, nunca do config do bloco. O
 * cliente admin passa por cima da RLS, e um id de outra organização colado no
 * config criaria campanha na base do vizinho.
 */
async function criarDisparoDoFluxo(
  admin: SupabaseClient,
  orgId: string,
  input: { pedido: PedidoDeDisparo; exec: FlowExecutionRow },
): Promise<DesfechoDoDisparo> {
  const { pedido } = input;
  try {
    const r = await criarDisparo(
      admin,
      { organizationId: orgId, autor: { tipo: "fluxo", flowExecutionId: input.exec.id } },
      {
        name: pedido.nome,
        channel_session_id: pedido.canalId,
        mode: pedido.modo,
        body: pedido.texto,
        template_name: pedido.modeloNome,
        template_language: pedido.modeloIdioma,
        template_values: pedido.modeloValores,
        interval_ms: pedido.intervaloMs,
        audiencia:
          pedido.audiencia.tipo === "tags"
            ? { kind: "tags", tags: pedido.audiencia.tags }
            : { kind: "contacts", contact_ids: pedido.audiencia.contatos },
      },
    );

    if (!r.ok) return { kind: "recusado", motivo: r.recusa.mensagem };

    let comecou = false;
    if (pedido.comecarSozinho) {
      // O ESTADO PRECISA SER EXATAMENTE ESTE.
      //
      // `fn_claim_due_bulk_sends` reclama `status = 'running' and next_send_at
      // <= now()`. Gravar `scheduled` — que era o que esta função fazia antes —
      // deixa a campanha esperando um promotor que só age sobre agendamento
      // futuro: ela nasce, aparece na tela como se fosse disparar, e não sai
      // nunca. Falha muda, do tipo que só se descobre pelo cliente que não
      // recebeu.
      //
      // É a mesma escrita do ramo "disparar agora" de
      // `app/api/v1/bulk-sends/[id]/start/route.ts`. Chamar aquela rota daqui
      // exigiria um request HTTP de dentro do motor; o que ela tem além disto
      // (rate limit por hora, auditoria de quem apertou) é de gente apertando
      // botão, e não se aplica a um bloco de fluxo.
      const agora = new Date().toISOString();
      const { error } = await admin
        .from("bulk_sends")
        .update({
          status: "running",
          scheduled_for: null,
          next_send_at: agora,
          started_at: agora,
          pause_reason: null,
          pause_detail: null,
        })
        .eq("id", r.disparoId)
        .eq("organization_id", orgId);
      comecou = error === null;
      if (error !== null) {
        logger.warn("[flow.bulk_send] campanha criada, mas nao consegui iniciar", {
          disparoId: r.disparoId,
          erro: error.message,
        });
      }
    }

    return { kind: "criado", disparoId: r.disparoId, vaoReceber: r.recorte.vaoReceber, comecou };
  } catch (err) {
    return { kind: "recusado", motivo: err instanceof Error ? err.message : "erro_ao_criar" };
  }
}

// ───────────────────────── envio ao contato do funil ─────────────────────────

/** O `type` que `sendMessageHandler` espera, para cada tipo da tela. */
const TIPO_NA_MENSAGEM: Record<TipoDeMensagemDoFluxo, string> = {
  texto: "text",
  imagem: "image",
  audio: "audio",
  video: "video",
  arquivo: "document",
};

/**
 * Manda para a conversa do contato — o cliente, não o vendedor.
 *
 * Difere de `enviarTextoParaTelefone` em três pontos, e cada um é o motivo de
 * ela existir separada:
 *
 *   1. o contato JÁ existe (veio dos fatos da execução); aqui não se cria nem
 *      se marca `force_human` — marcar faria o agente de IA calar numa conversa
 *      de cliente de verdade;
 *   2. a conexão pode ter sido ESCOLHIDA no bloco, em vez de ser a primeira
 *      viva da organização;
 *   3. aceita mídia.
 *
 * O que NÃO muda: continua passando por `sendMessageHandler`. É ele quem aplica
 * bloqueio do contato, janela do número, pacing anti-banimento e idempotência —
 * e um atalho pelo adapter arriscaria o número da empresa.
 */
async function enviarParaContatoDoFunil(
  admin: SupabaseClient,
  orgId: string,
  input: {
    contactId: string;
    tipo: TipoDeMensagemDoFluxo;
    texto: string;
    mediaUrl?: string;
    channelSessionId: string | null;
    exec: FlowExecutionRow;
  },
): Promise<DesfechoDeEnvio> {
  // A conexão escolhida precisa ser DESTA organização. Sem esta conferência, um
  // id copiado para o config de um fluxo mandaria pelo número de outro cliente —
  // o cliente admin não barraria, porque ele passa por cima da RLS.
  let sessionId = input.channelSessionId;
  if (sessionId !== null) {
    const { data } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (data === null) return { kind: "recusado", motivo: "conexao_nao_encontrada" };
  } else {
    sessionId = await sessaoProntaParaEnvio(admin, orgId);
  }
  if (sessionId === null) return { kind: "recusado", motivo: "sem_conexao_de_whatsapp" };

  try {
    const conversationId = await ensureConversation(admin, orgId, input.contactId, sessionId);
    const mensagem = (await sendMessageHandler(
      admin,
      {
        organization_id: orgId,
        actor: { type: "webhook_source", id: input.exec.flow_id },
        requestId: `flow:${input.exec.id}`,
      },
      {
        conversation_id: conversationId,
        type: TIPO_NA_MENSAGEM[input.tipo],
        body: input.texto,
        // `media_url`, nunca `media_storage_path`: ver a nota da porta em
        // `types.ts` — o caminho no Storage é conferido contra a conversa de
        // destino, e a mídia de um bloco vai para muitas conversas diferentes.
        ...(input.mediaUrl === undefined ? {} : { media_url: input.mediaUrl }),
      } as Parameters<typeof sendMessageHandler>[2],
    )) as unknown as MensagemEnviada;

    // O desfecho vem do ESTADO da mensagem: `sendMessageHandler` não lança
    // quando o envio falha — marca a linha e devolve normalmente.
    const traduzido = desfechoDoEnvio("flow.send_to_lead", mensagem);
    if (traduzido.status === "success") return { kind: "enviado", messageId: mensagem.id };
    if (traduzido.status === "postponed") {
      const motivo =
        typeof mensagem.metadata?.queued_reason === "string"
          ? mensagem.metadata.queued_reason
          : "aguardando_o_canal";
      return { kind: "na_fila", motivo };
    }
    return { kind: "recusado", motivo: mensagem.error_code ?? traduzido.error ?? "envio_recusado" };
  } catch (err) {
    return { kind: "recusado", motivo: err instanceof Error ? err.message : "erro_no_envio" };
  }
}

// ──────────────────────────── envio para telefone ────────────────────────────

async function enviarTextoParaTelefone(
  admin: SupabaseClient,
  orgId: string,
  input: { telefone: string; texto: string; interno: boolean; exec: FlowExecutionRow },
): Promise<DesfechoDeEnvio> {
  const sessionId = await sessaoProntaParaEnvio(admin, orgId);
  if (sessionId === null) return { kind: "recusado", motivo: "sem_conexao_de_whatsapp" };

  let contactId: string;
  try {
    contactId = await acharOuCriarContato(admin, orgId, input.telefone, input.interno);
  } catch (err) {
    return { kind: "recusado", motivo: err instanceof Error ? err.message : "contato_indisponivel" };
  }

  try {
    const conversationId = await ensureConversation(admin, orgId, contactId, sessionId);
    const mensagem = (await sendMessageHandler(
      admin,
      {
        organization_id: orgId,
        actor: { type: "webhook_source", id: input.exec.flow_id },
        requestId: `flow:${input.exec.id}`,
      },
      { conversation_id: conversationId, type: "text", body: input.texto } as Parameters<
        typeof sendMessageHandler
      >[2],
    )) as unknown as MensagemEnviada;

    // O desfecho vem do ESTADO da mensagem. `sendMessageHandler` NÃO lança
    // quando o envio falha — marca a linha e devolve normalmente. Reusar
    // `desfechoDoEnvio` é reusar essa lição, medida e paga no outro motor.
    const traduzido = desfechoDoEnvio("flow.notify_user", mensagem);
    if (traduzido.status === "success") return { kind: "enviado", messageId: mensagem.id };
    if (traduzido.status === "postponed") {
      const motivo =
        typeof mensagem.metadata?.queued_reason === "string"
          ? mensagem.metadata.queued_reason
          : "aguardando_o_canal";
      return { kind: "na_fila", motivo };
    }
    return { kind: "recusado", motivo: mensagem.error_code ?? traduzido.error ?? "envio_recusado" };
  } catch (err) {
    return { kind: "recusado", motivo: err instanceof Error ? err.message : "erro_no_envio" };
  }
}

/**
 * Contato para o telefone do aviso. Se for interno, nasce com `force_human`.
 *
 * ⚠️ `force_human = true` NÃO impede o Flow Engine de enviar — `sendMessageHandler`
 * só barra em `is_blocked`. O que ele faz é armar o `stopGate`, o primeiro gate
 * da cadeia `before_send`, de modo que o AGENTE DE IA não puxa conversa com o
 * vendedor quando ele responder ao aviso. Sem isto, avisar a equipe criaria um
 * contato que o agente trataria como cliente.
 */
async function acharOuCriarContato(
  admin: SupabaseClient,
  orgId: string,
  telefone: string,
  interno: boolean,
): Promise<string> {
  const { data: existente } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", telefone)
    .maybeSingle();
  if (existente !== null) return (existente as { id: string }).id;

  const { data: criado, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      phone_number: telefone,
      name: interno ? "Equipe (avisos)" : null,
      source: interno ? ORIGEM_DO_CONTATO_INTERNO : "flow_engine",
      force_human: interno,
    })
    .select("id")
    .single();

  if (error !== null) {
    // Corrida com outra execução avisando o mesmo vendedor no mesmo instante.
    if ((error as { code?: string }).code === "23505") {
      const { data: vencedor } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone_number", telefone)
        .maybeSingle();
      if (vencedor !== null) return (vencedor as { id: string }).id;
    }
    throw new Error(error.message);
  }
  return (criado as { id: string }).id;
}

// ───────────────────────────────── avisos ────────────────────────────────────

async function abrirAviso(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    titulo: string;
    corpo: string;
    severidade: string;
    refId: string;
  },
): Promise<void> {
  // `kind: 'other'` porque o CHECK de `agent_inbox_items.kind` é fechado, e
  // acrescentar um valor ali exigiria migration numa tabela que já tem clones
  // com linhas. `ref_kind` carrega a identidade real, e a tela de Erros filtra
  // por ele — vocabulário no ponteiro, não na constraint.
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: input.organizationId,
    kind: "other",
    severity: input.severidade,
    title: input.titulo,
    body: input.corpo,
    ref_kind: "flow_execution",
    ref_id: input.refId,
    status: "open",
  });
  if (error !== null) {
    // Aviso é secundário: falhar aqui não pode desfazer o que já aconteceu.
    logger.warn("flow-engine: não consegui abrir o aviso na Central", {
      erro: error.message,
      execution_id: input.refId,
    });
  }
}
