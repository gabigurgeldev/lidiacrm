/**
 * Flow Engine — quem ACORDA uma frente quando o evento que ela espera chega.
 *
 * `logic.await_event` põe a frente para dormir com um prazo no relógio. O prazo
 * o motor coleta sozinho, porque relógio vencido é a única coisa que o claim
 * sabe procurar. O EVENTO não — ninguém no sistema estava olhando, e sem este
 * arquivo a saída "Aconteceu" do bloco seria um handle que a pessoa liga no
 * canvas e por onde o fluxo nunca passa: toda espera terminaria pelo prazo,
 * inclusive as que o cliente respondeu em dois minutos.
 *
 * É consumidor do `event_log` como o `trigger-matcher`, e pelo mesmo motivo:
 * trigger do Postgres não faz HTTP e não acorda ninguém; quem reage a evento
 * neste produto é sempre um handler do barramento.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { eventoAcordaAFrente, type FrenteRow } from "./frentes";

export const CHAVE_DO_ACORDADOR = "flow-engine-evento";

/** Onde o payload do evento que acordou a frente fica visível a `{{frame.vars}}`. */
export const VAR_DO_EVENTO = "evento";

interface LinhaDeEvento {
  id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
}

export interface ResultadoDoAcordador {
  consumer_key: string;
  status: "ok" | "skipped" | "error";
  detail?: string;
}

/**
 * Acorda toda frente desta organização que esperava por este evento.
 *
 * ⚠️ Filtra `organization_id` à mão porque usa o cliente ADMIN, que passa por
 * cima da RLS — regra nº 10 dos anti-patterns. E a org vem da LINHA DO EVENTO,
 * nunca de entrada externa: sem isso, uma mensagem de um tenant acordaria a
 * espera de outro, que é vazamento de comportamento e não só de dado.
 */
export async function acordarFrentesQueEsperam(
  admin: SupabaseClient,
  row: LinhaDeEvento,
): Promise<ResultadoDoAcordador> {
  const payload = row.payload ?? {};

  const { data, error } = await admin
    .from("flow_execution_frames")
    .select("*")
    .eq("organization_id", row.organization_id)
    .eq("status", "waiting")
    .eq("awaiting_event_type", row.event_type);

  if (error !== null) {
    return { consumer_key: CHAVE_DO_ACORDADOR, status: "error", detail: error.message };
  }

  const candidatas = (data ?? []) as FrenteRow[];
  if (candidatas.length === 0) {
    // Ninguém esperava por isto. É o caso esmagadoramente comum — a maioria dos
    // eventos do sistema não tem nenhuma frente dormindo por eles.
    return { consumer_key: CHAVE_DO_ACORDADOR, status: "skipped", detail: "ninguem_esperava" };
  }

  // O `match` decide quais das candidatas são realmente desta conversa/pedido.
  // A comparação é a MESMA função que o teste de unidade exercita, e não uma
  // segunda cópia da regra: duas cópias divergem, e a que divergir vai acordar
  // o fluxo de outra pessoa.
  const acordar = candidatas.filter((f) =>
    eventoAcordaAFrente({ frente: f, eventType: row.event_type, payload }),
  );
  if (acordar.length === 0) {
    return { consumer_key: CHAVE_DO_ACORDADOR, status: "skipped", detail: "nenhuma_casou" };
  }

  const agora = new Date().toISOString();
  let acordadas = 0;

  for (const frente of acordar) {
    const { error: erroUp } = await admin
      .from("flow_execution_frames")
      .update({
        status: "ready",
        next_eval_at: agora,
        claimed_until: null,
        // ⚠️ Limpar `awaiting_event_type` É o sinal que o motor lê para saber
        // que esta volta é "o evento chegou" e não "o prazo venceu" — e é
        // também o que impede um SEGUNDO evento do mesmo tipo de acordar de
        // novo uma frente que já seguiu.
        awaiting_event_type: null,
        awaiting_match: null,
        wait_deadline: null,
        // O payload entra no espaço LOCAL da frente: duas frentes esperando
        // eventos diferentes não podem sobrescrever uma o evento da outra.
        vars: { ...frente.vars, [VAR_DO_EVENTO]: payload },
        updated_at: agora,
      })
      .eq("id", frente.id)
      .eq("organization_id", row.organization_id)
      // Só acorda quem AINDA espera. Se dois eventos chegarem juntos, o segundo
      // encontra zero linhas em vez de reescrever o estado do primeiro.
      .eq("awaiting_event_type", row.event_type)
      .eq("status", "waiting");
    if (erroUp !== null) {
      return { consumer_key: CHAVE_DO_ACORDADOR, status: "error", detail: erroUp.message };
    }

    // A execução dorme junto com a frente, então ela também precisa acordar —
    // é o relógio DELA que o claim do motor procura.
    await admin
      .from("flow_executions")
      .update({ status: "pending", next_eval_at: agora, claimed_until: null, updated_at: agora })
      .eq("id", frente.execution_id)
      .eq("organization_id", row.organization_id)
      .in("status", ["waiting", "pending"]);

    acordadas += 1;
  }

  return {
    consumer_key: CHAVE_DO_ACORDADOR,
    status: "ok",
    detail: `acordadas=${acordadas}`,
  };
}
