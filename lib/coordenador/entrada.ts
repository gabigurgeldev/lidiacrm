/**
 * Entrada de mensagem pelo coordenador — chamado no INÍCIO do turno de
 * entrada (`inbound-turn.ts`), depois do debounce que agrupa fragmentos.
 *
 * Por que no turno e não no webhook: a mensagem já foi persistida, o opt-out
 * aplicado e o provedor respondido em `pos-entrada.ts`; decidir aqui não atrasa
 * o reconhecimento do canal, e o debounce de entrada já agrupou "oi" / "queria
 * saber" / "sobre o plano" num lote — uma decisão por lote, não por fragmento.
 *
 * Modos:
 *   off     → `{ modo: "off" }`: o turno segue exatamente como antes.
 *   shadow  → decide (inclusive com o modelo, dentro do teto), grava a
 *             recomendação como `shadow` no diário e devolve `shadow`: NADA muda
 *             — nem dono, nem admissão, nem lead, nem envio.
 *   active  → aplica pela única porta (`transicionar`) e devolve quem conduz.
 *
 * Erro aqui nunca derruba o turno para o legado em `active` sem registro: o
 * chamador trata `erro` como "não conduzir agora" e o vigia (M4) recupera.
 */
import type pg from "pg";

import type { Consulta } from "./banco";
import {
  aplicarVeredito,
  decidir,
  type FatosDaConversa,
  type Proposta,
} from "./decidir";
import { TETO_DA_MENSAGEM, type CandidatoDoDecisor, type Decisao, type Decisor } from "./decisor/contrato";
import { admitir, lerEstado, transicionar, type EstadoDaConversa } from "./estado";
import { avaliarLimites, decisorPodeChamar, type TransicaoRecente } from "./limites";
import type { Motivo } from "./motivos";
import { carregarPoliticaEfetiva, type DestinoEfetivo, type PoliticaEfetiva } from "./politica/resolver";

export type ResultadoDaEntrada =
  | { modo: "off" }
  | { modo: "shadow"; recomendacao: string }
  | {
      modo: "active";
      acao: "agente";
      agentId: string;
      geracao: number;
      politicaVersaoId: string;
      motivo: Motivo;
    }
  | { modo: "active"; acao: "nada"; motivo: string };

export interface EntradaDoTurno {
  organizationId: string;
  conversationId: string;
  contactId: string;
  channelSessionId: string;
  jobId: string | null;
}

interface MensagemDoLote {
  id: string;
  body: string | null;
}

const LOTE_MAXIMO = 10;

async function lerFatos(
  db: Consulta,
  e: EntradaDoTurno,
  estado: EstadoDaConversa | null,
): Promise<FatosDaConversa> {
  const { rows } = await db.query<{
    humano: boolean;
    bloqueado: boolean;
    active_ai_agent_id: string | null;
  }>(
    `select (coalesce(ct.force_human, false)
             or c.assignee_kind = 'user'
             or c.status = 'claimed'
             or (c.bot_silenced_until is not null and c.bot_silenced_until > now())) as humano,
            coalesce(ct.is_blocked, false) as bloqueado,
            c.active_ai_agent_id
       from public.conversations c
       join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
      where c.organization_id = $1 and c.id = $2`,
    [e.organizationId, e.conversationId],
  );
  const f = rows[0];

  // Fluxo conduzindo: o do coordenador (dono) ou, antes da primeira transição,
  // o de triagem do legado (`silencia_ia`) — que é adotado, não reiniciado.
  // A execução dona só conduz enquanto está VIVA: um fluxo que concluiu ou
  // morreu devolve a conversa à decisão, em vez de seguir dono de nada.
  const dona =
    estado?.dono_tipo === "fluxo" && estado.dono_execution_id
      ? (
          await db.query<{ id: string; flow_id: string; viva: boolean }>(
            `select id, flow_id, status in ('pending', 'running', 'waiting') as viva
               from public.flow_executions
              where organization_id = $1 and id = $2`,
            [e.organizationId, estado.dono_execution_id],
          )
        ).rows[0] ?? null
      : null;
  const legado =
    dona?.viva === true
      ? null
      : (
          await db.query<{ id: string; flow_id: string }>(
            `select id, flow_id from public.flow_executions
              where organization_id = $1 and contact_id = $2 and silencia_ia
                and status in ('pending', 'running', 'waiting')
              order by started_at desc limit 1`,
            [e.organizationId, e.contactId],
          )
        ).rows[0] ?? null;
  const conduzindo = dona?.viva === true ? dona : legado;

  return {
    humanoNoComando: f?.humano === true,
    bloqueado: f?.bloqueado === true,
    agenteFixadoLegado: f?.active_ai_agent_id ?? null,
    fluxoVivoLegado: legado ? { executionId: legado.id } : null,
    flowIdConduzindo: conduzindo?.flow_id ?? null,
    ...(estado?.dono_tipo === "fluxo" ? { fluxoDoDonoVivo: dona?.viva === true } : {}),
  };
}

async function lerLote(db: Consulta, e: EntradaDoTurno): Promise<MensagemDoLote[]> {
  // O lote é o que o cliente disse DEPOIS da última fala da empresa e ainda
  // não foi admitido: é a pergunta em aberto, não o histórico. Sem o corte pela
  // última saída, a primeira ativação (ou o shadow, que não admite) juntaria
  // dias de conversa já respondida num texto só e decidiria sobre ele.
  // As MAIS RECENTES até o teto, devolvidas em ordem de relógio do WhatsApp com
  // desempate determinístico (nunca por uuid v4).
  const { rows } = await db.query<MensagemDoLote>(
    `select id, body from (
       select m.id, m.body, m.sent_at, m.created_at
         from public.messages m
        where m.organization_id = $1 and m.conversation_id = $2
          and m.direction = 'inbound'
          and m.created_at > now() - interval '2 days'
          and m.sent_at > coalesce((
                select max(o.sent_at) from public.messages o
                 where o.organization_id = $1 and o.conversation_id = $2
                   and o.direction = 'outbound'
              ), '-infinity'::timestamptz)
          and not exists (
            select 1 from public.coord_admissoes a
             where a.organization_id = m.organization_id and a.message_id = m.id
          )
        order by m.sent_at desc, m.created_at desc, m.id desc
        limit ${LOTE_MAXIMO}
     ) lote
     order by sent_at asc, created_at asc, id asc`,
    [e.organizationId, e.conversationId],
  );
  return rows;
}

async function lerRecentes(db: Consulta, e: EntradaDoTurno, minutos: number): Promise<TransicaoRecente[]> {
  const { rows } = await db.query<TransicaoRecente>(
    `select para_tipo, para_id::text as para_id, categoria, status, created_at::text as created_at
       from public.coord_transicoes
      where organization_id = $1 and conversation_id = $2
        and created_at > now() - ($3 || ' minutes')::interval
      order by created_at asc`,
    [e.organizationId, e.conversationId, String(minutos)],
  );
  return rows;
}

async function decisoesNaUltimaHora(db: Consulta, e: EntradaDoTurno): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from public.coord_transicoes
      where organization_id = $1 and conversation_id = $2
        and decisor_modelo is not null and created_at > now() - interval '1 hour'`,
    [e.organizationId, e.conversationId],
  );
  return Number(rows[0]?.n ?? 0);
}

function paraCandidato(d: DestinoEfetivo): CandidatoDoDecisor {
  return { chave: d.chave, nome: d.nome, quando_usar: d.quando_usar, exemplos: d.exemplos, nao_usar: d.nao_usar };
}

function decisorNoDetalhe(d: Decisao | null): Record<string, unknown> {
  if (!d) return {};
  return {
    decisor: {
      status: d.status,
      provedor: d.provedor,
      modelo: d.modelo,
      ms: d.ms,
      custo_cents: d.custoCents,
      confianca: d.confianca,
    },
  };
}

async function registrarDiario(
  db: Consulta,
  e: EntradaDoTurno,
  politica: PoliticaEfetiva,
  estado: EstadoDaConversa | null,
  status: "shadow" | "falhou" | "recusada",
  proposta: Proposta,
  decisao: Decisao | null,
  messageId: string | null,
): Promise<void> {
  const para =
    proposta.acao === "destino" || proposta.acao === "manter"
      ? { tipo: proposta.destino.tipo, id: proposta.destino.agent_id ?? proposta.destino.flow_id }
      : proposta.acao === "adotar_fluxo"
        ? { tipo: "fluxo", id: proposta.executionId }
        : { tipo: null, id: null };
  const categoria =
    proposta.acao === "destino" || proposta.acao === "manter"
      ? proposta.categoria === "manual"
        ? "manual"
        : proposta.categoria
      : proposta.acao === "adotar_fluxo"
        ? "continuidade"
        : "fallback";
  const motivo = "motivo" in proposta ? proposta.motivo : "decisor_falhou";
  await db.query(
    `insert into public.coord_transicoes
       (organization_id, conversation_id, de_tipo, de_id, para_tipo, para_id, categoria, motivo, status,
        politica_versao_id, versao, geracao, message_id,
        decisor_provedor, decisor_modelo, decisor_ms, decisor_custo_cents, decisor_confianca, detalhe)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
    [
      e.organizationId,
      e.conversationId,
      estado?.dono_tipo ?? null,
      estado?.dono_agent_id ?? estado?.dono_execution_id ?? null,
      para.tipo,
      para.id,
      categoria,
      motivo,
      status,
      politica.versao_id,
      estado?.versao ?? null,
      estado?.geracao ?? null,
      messageId,
      decisao?.provedor ?? null,
      decisao?.modelo ?? null,
      decisao?.ms ?? null,
      decisao?.custoCents ?? null,
      decisao?.confianca ?? null,
      JSON.stringify({ acao: proposta.acao }),
    ],
  );
}

/**
 * Inicia o fluxo destino e entrega a conversa a ele — numa transação só.
 * Sem isto, um crash entre os dois deixaria uma execução viva sem dono
 * (falaria sem coordenação) ou um dono sem execução (ninguém falaria).
 */
async function entregarAoFluxo(
  pool: pg.Pool,
  e: EntradaDoTurno,
  destino: DestinoEfetivo,
  politica: PoliticaEfetiva,
  estado: EstadoDaConversa | null,
  categoria: "regra" | "continuidade" | "modelo" | "manual" | "fallback",
  motivo: Motivo,
  mensagem: MensagemDoLote | null,
  detalhe: Record<string, unknown>,
): Promise<{ ok: true; executionId: string; geracao: number } | { ok: false; motivo: string }> {
  if (!destino.flow_id || !destino.flow_version_id) return { ok: false, motivo: "destino_inelegivel" };
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    // A execução começa no bloco de GATILHO da versão ativa — o mesmo ponto de
    // entrada que `chamarSubFluxo` usa. `current_node_id` é NOT NULL: sem ele
    // o insert falhava e nenhuma conversa chegava a um fluxo.
    const { rows: entrada } = await cliente.query<{ node_id: string | null }>(
      `select (select n->>'id' from jsonb_array_elements(v.graph->'nodes') n
                where n->>'type' like 'trigger.%' limit 1) as node_id
         from public.flow_versions v
        where v.organization_id = $1 and v.id = $2`,
      [e.organizationId, destino.flow_version_id],
    );
    const noDeEntrada = entrada[0]?.node_id ?? null;
    if (noDeEntrada === null) {
      await cliente.query("rollback");
      return { ok: false, motivo: "destino_inelegivel" };
    }
    const { rows } = await cliente.query<{ id: string }>(
      `insert into public.flow_executions
         (organization_id, flow_id, version_id, status, current_node_id, next_eval_at, contact_id, conversation_id,
          input, context, lineage)
       values ($1, $2, $3, 'pending', $8, now(), $4, $5, $6::jsonb, '{}'::jsonb, $7::jsonb)
       returning id`,
      [
        e.organizationId,
        destino.flow_id,
        destino.flow_version_id,
        e.contactId,
        e.conversationId,
        JSON.stringify({
          message_id: mensagem?.id ?? null,
          conversation_id: e.conversationId,
          contact_id: e.contactId,
          channel_session_id: e.channelSessionId,
          direction: "inbound",
          body_preview: (mensagem?.body ?? "").slice(0, 280),
        }),
        JSON.stringify({ origem: "coordenador", politica_versao_id: politica.versao_id }),
        noDeEntrada,
      ],
    );
    const executionId = rows[0]!.id;
    const r = await transicionar(cliente, {
      organizationId: e.organizationId,
      conversationId: e.conversationId,
      versaoEsperada: estado?.versao ?? 0,
      para: { tipo: "fluxo", executionId, frameId: null },
      situacao: "ativo",
      categoria,
      motivo,
      politicaVersaoId: politica.versao_id,
      messageId: mensagem?.id ?? null,
      detalhe,
    });
    if (!r.ok) {
      await cliente.query("rollback");
      return { ok: false, motivo: r.motivo };
    }
    await cliente.query("commit");
    return { ok: true, executionId, geracao: r.geracao };
  } catch (err) {
    await cliente.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    cliente.release();
  }
}

/**
 * A porta do turno. Duas regras de falha, deliberadamente diferentes:
 *
 *   - não deu para LER a política → `off`: o coordenador é aditivo, e um banco
 *     sem a migration (ou um soluço de leitura) não pode calar o atendimento
 *     de quem nunca o ligou;
 *   - a política É `active` e algo falhou depois → `nada` com motivo `erro`:
 *     cair no legado aqui faria o roteador antigo falar por cima de um dono que
 *     o coordenador pode já ter gravado. O vigia (M4) recupera a conversa.
 *
 * Em `shadow`, qualquer falha vira `shadow` — o legado segue intacto.
 */
export async function coordenarTurnoDeEntrada(
  pool: pg.Pool,
  decisor: Decisor,
  e: EntradaDoTurno,
  deps: { agora?: () => Date; log?: { warn: (msg: string, f?: Record<string, unknown>) => void } } = {},
): Promise<ResultadoDaEntrada> {
  let politica: PoliticaEfetiva | null;
  try {
    politica = await carregarPoliticaEfetiva(pool, e.organizationId, e.channelSessionId);
  } catch (err) {
    deps.log?.warn("coordenador: política não lida — turno segue sem coordenação", { error: resumoDoErro(err) });
    return { modo: "off" };
  }
  if (!politica || politica.modo === "off") return { modo: "off" };
  try {
    return await coordenarComPolitica(pool, decisor, e, politica, deps.agora ?? (() => new Date()));
  } catch (err) {
    deps.log?.warn("coordenador: falha ao coordenar o turno", { modo: politica.modo, error: resumoDoErro(err) });
    return politica.modo === "shadow"
      ? { modo: "shadow", recomendacao: "erro" }
      : { modo: "active", acao: "nada", motivo: "erro" };
  }
}

function resumoDoErro(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : "erro desconhecido";
}

async function coordenarComPolitica(
  pool: pg.Pool,
  decisor: Decisor,
  e: EntradaDoTurno,
  politica: PoliticaEfetiva,
  agora: () => Date,
): Promise<ResultadoDaEntrada> {

  const estado = await lerEstado(pool, e.organizationId, e.conversationId);
  const [fatos, lote] = await Promise.all([lerFatos(pool, e, estado), lerLote(pool, e)]);
  const ultima = lote[lote.length - 1] ?? null;

  // Reentrega: tudo já admitido. Se o dono é um agente, este é o mesmo turno
  // retomado (crash, lease vencido) — segue com a geração que já está lá.
  if (lote.length === 0) {
    if (politica.modo === "active" && estado?.dono_tipo === "agente" && estado.dono_agent_id) {
      return {
        modo: "active",
        acao: "agente",
        agentId: estado.dono_agent_id,
        geracao: estado.geracao,
        politicaVersaoId: politica.versao_id,
        motivo: "continua_responsavel",
      };
    }
    return politica.modo === "shadow"
      ? { modo: "shadow", recomendacao: "ja_admitido" }
      : { modo: "active", acao: "nada", motivo: "ja_admitido" };
  }

  const texto = lote
    .map((m) => m.body ?? "")
    .filter(Boolean)
    .join("\n")
    .slice(0, TETO_DA_MENSAGEM);

  let proposta = decidir({ estado, politica, texto, fatos });
  let decisao: Decisao | null = null;

  if (proposta.acao === "consultar_modelo") {
    const consulta = proposta;
    const podeChamar = decisorPodeChamar({
      chamadasNaUltimaHora: await decisoesNaUltimaHora(pool, e),
      limites: politica.config.limites,
    });
    decisao = podeChamar
      ? await decisor.decidir({
          organizationId: e.organizationId,
          conversationId: e.conversationId,
          contactId: e.contactId,
          jobId: e.jobId,
          mensagem: texto,
          contexto: [],
          atual: consulta.atual ? paraCandidato(consulta.atual) : null,
          candidatos: consulta.candidatos.map(paraCandidato),
          timeoutMs: politica.config.limites.decisor_timeout_ms,
        })
      : null;
    proposta = aplicarVeredito(
      consulta,
      { escolha: decisao?.status === "ok" ? decisao.escolha : null, confianca: decisao?.confianca ?? null },
      politica,
    );
  }

  // Limites (só quando a proposta TROCA de executor).
  if (proposta.acao === "destino") {
    const destinoId = proposta.destino.agent_id ?? proposta.destino.flow_id ?? "";
    const trocou =
      !(estado?.dono_tipo === "agente" && estado.dono_agent_id === proposta.destino.agent_id) &&
      !(estado?.dono_tipo === "fluxo" && proposta.destino.tipo === "fluxo" && fatos.flowIdConduzindo === proposta.destino.flow_id);
    if (trocou) {
      const veredito = avaliarLimites({
        recentes: await lerRecentes(pool, e, politica.config.limites.janela_minutos),
        limites: politica.config.limites,
        agora: agora(),
        proposta: {
          para_tipo: proposta.destino.tipo,
          para_id: destinoId,
          categoria: proposta.categoria === "manual" ? "manual" : proposta.categoria,
        },
      });
      if (!veredito.ok) {
        const atual =
          estado?.dono_tipo === "agente"
            ? politica.destinos.find((d) => d.agent_id === estado.dono_agent_id && d.elegivel) ?? null
            : null;
        proposta = atual
          ? { acao: "manter", destino: atual, categoria: "fallback", motivo: veredito.motivo }
          : { acao: "sem_destino", motivo: veredito.motivo };
      }
    }
  }

  // ─── shadow: só o diário ────────────────────────────────────────────────
  if (politica.modo === "shadow") {
    // `nada` (pessoa no comando, contato bloqueado) não é recomendação: o
    // legado já se cala nesses casos, e gravá-lo só encheria o diário.
    if (proposta.acao !== "nada") {
      await registrarDiario(pool, e, politica, estado, "shadow", proposta, decisao, ultima?.id ?? null);
    }
    return { modo: "shadow", recomendacao: proposta.acao };
  }

  // ─── active ─────────────────────────────────────────────────────────────
  const detalhe = { lote: lote.length, ...decisorNoDetalhe(decisao) };
  const admitirLote = async (tipo: "agente" | "fluxo" | "nenhum", id: string | null, geracao: number) => {
    for (const m of lote) {
      await admitir(pool, {
        organizationId: e.organizationId,
        messageId: m.id,
        conversationId: e.conversationId,
        consumidorTipo: tipo,
        consumidorId: id,
        perguntaId: null,
        geracao,
      });
    }
  };

  switch (proposta.acao) {
    case "nada": {
      // Pessoa ou bloqueio: a mensagem é da equipe; admitida para ninguém
      // automático, para não ser reprocessada como pendente. Resposta a um
      // fluxo NÃO é admitida aqui: quem a consome é a frente que pergunta.
      if (proposta.motivo !== "resposta_a_pergunta") await admitirLote("nenhum", null, estado?.geracao ?? 0);
      return { modo: "active", acao: "nada", motivo: proposta.motivo };
    }
    case "sem_destino": {
      await registrarDiario(pool, e, politica, estado, "falhou", proposta, decisao, ultima?.id ?? null);
      return { modo: "active", acao: "nada", motivo: proposta.motivo };
    }
    case "adotar_fluxo": {
      const r = await transicionar(pool, {
        organizationId: e.organizationId,
        conversationId: e.conversationId,
        versaoEsperada: estado?.versao ?? 0,
        para: { tipo: "fluxo", executionId: proposta.executionId, frameId: null },
        situacao: "esperando_cliente",
        categoria: "continuidade",
        motivo: "reconciliacao",
        politicaVersaoId: politica.versao_id,
        messageId: ultima?.id ?? null,
        detalhe,
      });
      return { modo: "active", acao: "nada", motivo: r.ok ? "reconciliacao" : r.motivo };
    }
    case "manter":
    case "destino": {
      const destino = proposta.destino;
      if (destino.tipo === "fluxo") {
        const r = await entregarAoFluxo(
          pool,
          e,
          destino,
          politica,
          estado,
          proposta.categoria,
          proposta.motivo,
          ultima,
          detalhe,
        );
        if (r.ok) await admitirLote("fluxo", r.executionId, r.geracao);
        return { modo: "active", acao: "nada", motivo: r.ok ? proposta.motivo : r.motivo };
      }
      const agentId = destino.agent_id!;
      const jaConduz = estado?.dono_tipo === "agente" && estado.dono_agent_id === agentId;
      let geracao = estado?.geracao ?? 0;
      if (!jaConduz) {
        const r = await transicionar(pool, {
          organizationId: e.organizationId,
          conversationId: e.conversationId,
          versaoEsperada: estado?.versao ?? 0,
          para: { tipo: "agente", agentId, agentVersionId: destino.agent_version_id },
          situacao: "ativo",
          categoria: proposta.categoria,
          motivo: proposta.motivo,
          politicaVersaoId: politica.versao_id,
          messageId: ultima?.id ?? null,
          detalhe,
        });
        // Conflito: outra decisão (ou uma pessoa) mudou o estado enquanto este
        // turno decidia. O resultado é descartado — quem mudou já despachou.
        if (!r.ok) return { modo: "active", acao: "nada", motivo: r.motivo };
        geracao = r.geracao;
      }
      await admitirLote("agente", agentId, geracao);
      return {
        modo: "active",
        acao: "agente",
        agentId,
        geracao,
        politicaVersaoId: politica.versao_id,
        motivo: proposta.motivo,
      };
    }
    case "consultar_modelo":
      // Inalcançável: aplicarVeredito sempre resolve a consulta.
      return { modo: "active", acao: "nada", motivo: "decisor_falhou" };
  }
}
