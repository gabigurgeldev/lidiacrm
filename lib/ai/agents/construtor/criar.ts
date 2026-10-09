/**
 * Cria o agente que o construtor montou — a ÚNICA escrita do fluxo, e só
 * depois de a pessoa revisar e clicar.
 *
 * Ordem, e por quê:
 *
 *   1. tudo o que pode ser recusado SEM escrever (canal, provedor, teto de
 *      capacidades, forma da versão) é conferido ANTES — recusar depois de criar
 *      metade é o pior desfecho;
 *   2. os materiais primeiro, porque a versão aponta para eles;
 *   3. agente + versão 1 em RASCUNHO. Nunca publicado: quem coloca no ar é a
 *      pessoa, no editor, depois de ler o prompt.
 *
 * Falha depois dos materiais NÃO os apaga: material é da organização (0181),
 * útil sozinho, e a pessoa vê na resposta o que foi e o que não foi criado.
 *
 * A memória da organização NÃO é tocada (o onboarding grava "regras da casa"
 * lá): publicá-la sobrescreveria as regras que valem para TODOS os agentes. O
 * que é deste agente mora no prompt dele.
 *
 * `organizationId` vem de quem chama, que o resolveu da sessão — nunca do
 * corpo da requisição.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { capacidadesPorPacote, catalogoComHandler } from "@/lib/ai/agents/capacidades-padrao";
import { linhaDeVersaoNova } from "@/lib/ai/agents/linha-da-versao";
import { resolverProvedorDoAgente } from "@/lib/ai/agents/provedor-do-agente";
import { versionCreateSchema, type VersionInput } from "@/lib/ai/agents/validation";
import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { criarMaterialDeTexto } from "@/lib/ai/rag/criar-material";
import { ligarPacote } from "@/lib/mcp/tools/selecao-por-pacote";

import { pacotesQueCabem } from "./capacidades";
import type { Previa } from "./esquemas";

export type ResultadoDaCriacao =
  | {
      ok: true;
      agent_id: string;
      version_id: string;
      materiais: Array<{ id: string; nome: string }>;
      materiais_com_falha: Array<{ nome: string; motivo: string }>;
      avisos: string[];
      indexacao_habilitada: boolean;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      /** Materiais que JÁ foram criados quando a falha aconteceu. */
      materiais_criados?: Array<{ id: string; nome: string }>;
    };

type Recusa = Extract<ResultadoDaCriacao, { ok: false }>;

export async function criarAgenteDaPrevia(
  admin: SupabaseClient,
  ctx: { organizationId: string; userId: string; requestId: string },
  previa: Previa,
): Promise<ResultadoDaCriacao> {
  const { organizationId: orgId, userId, requestId } = ctx;
  const recusa = (status: number, code: string, message: string): Recusa => ({
    ok: false,
    status,
    code,
    message,
  });

  // ── 1. Conferências que não escrevem nada ────────────────────────────────
  let canais;
  try {
    canais = await listSelectableChannels(admin, orgId);
  } catch {
    return recusa(500, "internal_error", "Não consegui ler os números de WhatsApp desta organização.");
  }
  if (!canais.some((c) => c.id === previa.channel_session_id)) {
    return recusa(422, "validation_failed", "Escolha um número de WhatsApp desta organização.");
  }

  const provedor = await resolverProvedorDoAgente(admin, orgId);
  if (!provedor.ok && provedor.reason !== "sem_chave") {
    return recusa(
      422,
      "ai_provider_error",
      provedor.reason === "no_model"
        ? "O provedor de IA desta instalação ainda não tem um modelo disponível. Confira em Uso de IA › Provedores."
        : "Não consegui descobrir qual provedor de IA esta instalação usa.",
    );
  }

  const catalogo = catalogoComHandler();
  const { cabem, foraDoTeto } = pacotesQueCabem(previa.pacotes, capacidadesPorPacote(catalogo));
  if (foraDoTeto.length > 0) {
    return recusa(
      422,
      "validation_failed",
      "Capacidades demais para um agente só. Desligue algum pacote e tente de novo.",
    );
  }
  const toolIds = cabem.reduce<string[]>((sel, p) => ligarPacote(sel, catalogo, p), []);

  // "Em que negócios ele pode mexer": o funil padrão, como no onboarding. Falha
  // ou ausência = escopo vazio, nunca um funil chutado.
  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();

  const montar = (knowledgeIds: string[]) =>
    versionCreateSchema.safeParse({
      system_prompt: previa.system_prompt,
      provider: provedor.provider,
      model: provedor.modelId,
      credential_id: provedor.ok ? provedor.credentialId : null,
      tool_ids: toolIds,
      channel_session_id: previa.channel_session_id,
      handoff_keywords: previa.handoff_keywords.length > 0 ? previa.handoff_keywords : undefined,
      pipeline_ids: funil?.id ? [funil.id as string] : [],
      knowledge_source_ids: knowledgeIds,
    });

  // A forma é conferida ANTES de qualquer escrita, com o acervo vazio; o acervo
  // real entra depois, e ids de material recém-criado não mudam a forma.
  const ensaio = montar([]);
  if (!ensaio.success) {
    return recusa(422, "validation_failed", "A configuração gerada não é válida. Revise o prompt e as capacidades.");
  }

  // ── 2. Materiais ─────────────────────────────────────────────────────────
  const materiais: Array<{ id: string; nome: string }> = [];
  const materiaisComFalha: Array<{ nome: string; motivo: string }> = [];
  for (const m of previa.materiais) {
    const r = await criarMaterialDeTexto(admin, orgId, {
      tipo: m.tipo,
      nome: m.nome,
      itens: m.itens?.map((i) => ({ question: i.pergunta, answer: i.resposta })),
      texto: m.texto,
      // Nome em uso por um material que já existe: ganha sufixo, em vez de
      // perder o material por causa do nome.
      renomearSeEmUso: true,
      metadata: { criado_por: "construtor_de_agente" },
    });
    if (r.ok) materiais.push({ id: r.id, nome: r.nome });
    else materiaisComFalha.push({ nome: m.nome, motivo: r.mensagem });
  }

  const versao = montar(materiais.map((m) => m.id));
  if (!versao.success) {
    return { ...recusa(500, "internal_error", "Não consegui montar a versão do agente."), materiais_criados: materiais };
  }
  const v: VersionInput = versao.data;

  // ── 3. Agente + versão 1 em rascunho ─────────────────────────────────────
  const { data: agente, error: agenteErr } = await admin
    .from("ai_agents")
    .insert({
      organization_id: orgId,
      name: previa.nome,
      description: previa.descricao ?? null,
      model: `${v.provider}/${v.model}`,
      system_prompt: v.system_prompt,
      is_active: true,
      is_default: false,
      kind: "mcp_agent",
      priority: 0,
      created_by: userId,
    })
    .select("id")
    .single();
  if (agenteErr || !agente) {
    return { ...recusa(500, "internal_error", "Erro ao criar o agente."), materiais_criados: materiais };
  }
  const agentId = (agente as { id: string }).id;

  const { data: linha, error: versaoErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      version_number: 1,
      ...linhaDeVersaoNova(v),
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();
  if (versaoErr || !linha) {
    // Agente sem v1 é inútil: arquiva, como a rota de criação faz.
    await admin
      .from("ai_agents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", agentId)
      .eq("organization_id", orgId);
    return { ...recusa(500, "internal_error", "Erro ao criar a versão inicial do agente."), materiais_criados: materiais };
  }
  const versionId = (linha as { id: string }).id;

  void audit({
    action: "ai_agent.created",
    actorUserId: userId,
    organizationId: orgId,
    resourceType: "ai_agent",
    resourceId: agentId,
    requestId,
    metadata: {
      kind: "mcp_agent",
      origem: "construtor",
      first_version_id: versionId,
      pacotes: cabem,
      materiais: materiais.map((m) => m.id),
      materiais_com_falha: materiaisComFalha.length,
    },
  });

  await admin.from("event_log").insert({
    organization_id: orgId,
    event_type: "ai_agent.created",
    payload: { agent_id: agentId, source: "construtor", published: false },
  });

  const avisos: string[] = [];
  if (!provedor.ok) {
    avisos.push(
      "Nenhuma chave de IA utilizável para o provedor desta instalação. Cadastre uma em IA › Credenciais antes de publicar.",
    );
  }
  const indexacao = materiais.length > 0 ? await temChaveDeEmbedding(orgId) : true;

  return {
    ok: true,
    agent_id: agentId,
    version_id: versionId,
    materiais,
    materiais_com_falha: materiaisComFalha,
    avisos,
    indexacao_habilitada: indexacao,
  };
}
