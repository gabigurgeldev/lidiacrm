/**
 * A PONTE ENTRE O MOTOR DE PACING E O MUNDO DO SUPABASE.
 *
 * ═══ Por que existe ═══
 *
 * `lib/agent-engine/pacing/store.ts` — `loadChannelKnobs`, `loadPacingState`,
 * `recordSend` — fala `pg.Pool` (o `Queryable` do agent-engine, que roda como
 * daemon). O worker do disparo roda dentro do Next e fala Supabase. São dois
 * transportes para as MESMAS tabelas.
 *
 * ═══ O que é reusado e o que é reescrito ═══
 *
 * A REGRA é importada, nunca reescrita: `decidePacing`, `dayStartInTz`,
 * `warmupCapFor` vêm de `pacing/engine.ts`. Os DEFAULTS vêm de
 * `pacing/defaults.ts`. Só a LEITURA DA LINHA é reescrita aqui, contra as mesmas
 * tabelas (`channel_knobs` via `configDePacingDoCanal`, `pacing_ledger` aqui).
 *
 * É exatamente a ponte mínima que `lib/automation/janela-do-canal.ts` já
 * descreve no cabeçalho dele, e pelo mesmo motivo: duas cópias da REGRA
 * divergem; duas cópias da QUERY, não.
 *
 * ═══ Por que o disparo escreve no `pacing_ledger` ═══
 *
 * Porque senão ele seria INVISÍVEL ao anti-ban do agente. O ledger é por
 * (organização, número): o agente lê dele para saber quantas mensagens aquele
 * número já mandou hoje. Um disparo que enviasse 200 sem registrar deixaria o
 * agente achar que o número está fresco — e os dois somariam volume no mesmo
 * chip sem nunca se enxergarem. É o cenário que bane.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dayStartInTz, type PacingState } from "@/lib/agent-engine/pacing/engine";
import { logger } from "@/lib/logger";

/**
 * `lastSentAt` (qualquer dia) e `sentToday` (desde a meia-noite LOCAL do
 * tenant). Espelha `loadPacingState` do store, com PostgREST no lugar do SQL.
 *
 * Duas queries em vez do `max(...) + count(...) filter (...)` de lá: o
 * PostgREST não expõe agregação com filtro. `head: true` + `count: "exact"`
 * traz só o número, sem as linhas — o ledger de um número movimentado tem
 * milhares por dia e trazê-las seria pagar rede por um inteiro.
 */
export async function estadoDePacing(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  entrada: { agora: Date; timezone: string; numberActivatedAt: Date | null },
): Promise<PacingState> {
  const inicioDoDia = dayStartInTz(entrada.agora, entrada.timezone);

  const [ultimo, hoje] = await Promise.all([
    admin
      .from("pacing_ledger")
      .select("sent_at")
      .eq("organization_id", organizationId)
      .eq("channel_session_id", channelSessionId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("pacing_ledger")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("channel_session_id", channelSessionId)
      .gte("sent_at", inicioDoDia.toISOString()),
  ]);

  // Falha FECHADA, e a diferença importa. Uma leitura que falha não pode virar
  // "zero enviados hoje": isso liberaria a campanha a estourar o cap diário
  // justamente quando o banco está ruim. Sem saber quanto saiu, o motor assume
  // o pior — `Infinity` faz `decidePacing` vetar por cap e adiar para amanhã.
  if (hoje.error) {
    logger.warn("[bulk-send.pacing] não foi possível contar os envios de hoje — assumindo o cap cheio", {
      organizationId,
      channelSessionId,
      causa: hoje.error.message,
    });
    return {
      lastSentAt: null,
      sentToday: Number.POSITIVE_INFINITY,
      numberActivatedAt: entrada.numberActivatedAt,
    };
  }

  const linha = ultimo.data as { sent_at: string } | null;
  return {
    // `lastSentAt` nulo é seguro: sem último envio, `decidePacing` não aplica
    // gap, e quem espaça a campanha é `intervaloEfetivo` de qualquer jeito.
    lastSentAt: linha?.sent_at ? new Date(linha.sent_at) : null,
    sentToday: hoje.count ?? 0,
    numberActivatedAt: entrada.numberActivatedAt,
  };
}

/**
 * Registra um envio EFETIVADO. Espelha `recordSend` do store.
 *
 * Só o que o canal ACEITOU entra aqui — nunca uma falha, nunca um `queued`.
 * É o mesmo critério do agent-engine: o ledger mede o que saiu pelo número, e
 * contar tentativa frustrada faria o warm-up "gastar" cota que ninguém usou.
 *
 * Não lança: o envio já aconteceu, e derrubar o tique depois de a mensagem ter
 * saído não a traz de volta — só faria o destinatário ficar em `sending` e o
 * motor reprocessá-lo. O erro vira log; o pior caso é o número ganhar um pouco
 * de folga no cap, nunca perdê-la.
 */
export async function registrarEnvioNoLedger(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  sentAt: Date = new Date(),
): Promise<void> {
  const { error } = await admin.from("pacing_ledger").insert({
    organization_id: organizationId,
    channel_session_id: channelSessionId,
    sent_at: sentAt.toISOString(),
  });
  if (error) {
    logger.warn("[bulk-send.pacing] envio não registrado no ledger — o anti-ban perde uma contagem", {
      organizationId,
      channelSessionId,
      causa: error.message,
    });
  }
}
