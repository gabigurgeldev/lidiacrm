/**
 * Flow Engine — o matcher: evento do `event_log` vira execução de fluxo.
 *
 * Não há relógio novo aqui. O barramento é o `event_log` que o repo já tem, e
 * o consumo é o contrato de drain que já existe (`consumed_by`, claim otimista,
 * backoff). O que este arquivo acrescenta é a tradução "este evento arma
 * aqueles fluxos" — e nada mais.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

import { flowGraphSchema } from "./graph-schema";
import { garantirNosRegistrados } from "./register-all";
import { todosOsNos } from "./registry";

/** A chave que fica em `event_log.consumed_by`. Estável para sempre. */
export const CHAVE_DO_MATCHER = "flow-engine";

/** Marca que o motor põe no que ele mesmo causa — é o anti-loop. */
export const CAUSADO_POR_FLUXO = "caused_by_flow";

/**
 * Os `event_type` que o matcher escuta, DERIVADOS do registry.
 *
 * Nunca uma lista digitada em paralelo: um gatilho novo entraria na paleta,
 * ficaria desenhável, e nunca dispararia — o modo de falha mais caro possível,
 * porque a tela afirma que existe.
 */
export function eventosEscutados(): string[] {
  garantirNosRegistrados();
  const eventos = todosOsNos().flatMap((n) => [...(n.eventos ?? [])]);
  return [...new Set(eventos)].sort();
}

interface LinhaDeFluxo {
  id: string;
  organization_id: string;
  active_version_id: string | null;
  settings: Record<string, unknown>;
}

/**
 * O primeiro nó do grafo publicado — onde a execução começa.
 *
 * Sai da VERSÃO e não do rascunho: o rascunho pode estar meio editado enquanto
 * a versão publicada segue disparando, e começar por um nó que só existe no
 * rascunho criaria execução que morre no primeiro tick.
 */
function acharGatilho(graph: unknown, tipos: ReadonlySet<string>): string | null {
  const parsed = flowGraphSchema.safeParse(graph);
  if (!parsed.success) return null;
  const gatilho = parsed.data.nodes.find((n) => tipos.has(n.type));
  return gatilho?.id ?? null;
}

export async function armarFluxosParaEvento(
  admin: SupabaseClient,
  row: EventRow,
): Promise<HandlerResult> {
  garantirNosRegistrados();

  // ── anti-loop, profundidade 1 ────────────────────────────────────────────
  // Espelha o `caused_by_rule` de `lib/automation/engine.ts`: um evento que o
  // próprio motor causou não arma fluxo, salvo opt-in explícito no fluxo. Sem
  // isto, um fluxo que marca o lead dispararia o fluxo que escuta marcação, que
  // marca de novo — e o teto de passos só apareceria depois de encher a fila.
  const causadoPorFluxo =
    typeof row.metadata?.[CAUSADO_POR_FLUXO] === "string"
      ? (row.metadata[CAUSADO_POR_FLUXO] as string)
      : null;

  const tiposDeGatilho = new Set(
    todosOsNos()
      .filter((n) => (n.eventos ?? []).includes(row.event_type))
      .map((n) => n.type),
  );
  if (tiposDeGatilho.size === 0) {
    return { consumer_key: CHAVE_DO_MATCHER, status: "skipped", detail: "nenhum_gatilho_para_o_evento" };
  }

  const { data, error } = await admin
    .from("flows")
    .select("id, organization_id, active_version_id, settings")
    .eq("organization_id", row.organization_id)
    .eq("status", "active")
    .not("active_version_id", "is", null);

  if (error !== null) {
    // `error` e não `skipped`: o drain reagenda com backoff. Marcar consumido
    // aqui perderia o evento para sempre por uma falha passageira de leitura.
    return { consumer_key: CHAVE_DO_MATCHER, status: "error", detail: error.message };
  }

  const fluxos = (data ?? []) as LinhaDeFluxo[];
  if (fluxos.length === 0) {
    return { consumer_key: CHAVE_DO_MATCHER, status: "skipped", detail: "nenhum_fluxo_ativo" };
  }

  const leadId = row.entity_kind === "lead" || row.entity_kind === "crm_lead" ? row.entity_id : null;
  const contactId = typeof row.payload?.contact_id === "string" ? row.payload.contact_id : null;

  let armados = 0;
  let pulados = 0;

  for (const fluxo of fluxos) {
    if (causadoPorFluxo !== null && fluxo.settings?.reagir_ao_proprio_motor !== true) {
      pulados += 1;
      continue;
    }

    const { data: versao } = await admin
      .from("flow_versions")
      .select("id, graph, trigger_config")
      .eq("organization_id", fluxo.organization_id)
      .eq("id", fluxo.active_version_id)
      .maybeSingle();
    const v = versao as { id: string; graph: unknown; trigger_config: unknown } | null;
    if (v === null) {
      pulados += 1;
      continue;
    }

    const nodeId = acharGatilho(v.graph, tiposDeGatilho);
    if (nodeId === null) {
      // A versão publicada não tem gatilho deste tipo — o fluxo escuta outra
      // coisa. Não é erro: é só não ser para ele.
      pulados += 1;
      continue;
    }

    const { error: insErr } = await admin.from("flow_executions").insert({
      organization_id: fluxo.organization_id,
      flow_id: fluxo.id,
      version_id: v.id,
      status: "pending",
      current_node_id: nodeId,
      // Vencida AGORA: o próximo tick pega. Não é `null` porque o CHECK de
      // relógio do schema recusa estado ativo sem hora.
      next_eval_at: new Date().toISOString(),
      lead_id: leadId,
      contact_id: contactId,
      trigger_event_id: row.id,
      lineage: { evento: row.event_type, event_id: row.id },
      context: {},
    });

    if (insErr !== null) {
      // 23505 = `uniq_flow_executions_trigger_event`. O drain reentregou o
      // evento (retry, ou dois workers), e este fluxo JÁ foi armado por ele.
      // É o desenho funcionando, não um erro.
      if ((insErr as { code?: string }).code === "23505") {
        pulados += 1;
        continue;
      }
      return { consumer_key: CHAVE_DO_MATCHER, status: "error", detail: insErr.message };
    }
    armados += 1;
  }

  if (armados > 0) {
    logger.info("flow-engine: fluxos armados", {
      event_type: row.event_type,
      event_id: row.id,
      armados,
      pulados,
    });
  }

  return {
    consumer_key: CHAVE_DO_MATCHER,
    status: "ok",
    detail: `armados=${armados} pulados=${pulados}`,
  };
}
