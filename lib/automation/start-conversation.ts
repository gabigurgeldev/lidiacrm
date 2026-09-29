/**
 * Conversa programática p/ automação: acha a conversa aberta do contato na
 * sessão, REABRE a fechada, ou cria uma nova. Distinto da ingestão WAHA (que
 * usa RPCs de identidade) — aqui contato e sessão já são conhecidos.
 *
 * Por que reabrir: o índice uniq_conversations_1to1_per_contact_session é
 * único por (org, contato, sessão) SEM filtro de status — um contato cuja
 * única conversa está closed/archived tornaria o INSERT impossível (23505) e
 * o envio automatizado falharia pra sempre. Reabrir é também o comportamento
 * certo de produto: a conversa É o thread com aquele contato naquele número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";

const OPEN_STATUSES = ["open", "pending", "claimed", "ai_handling"];

/** Sessão viva da org: WORKING primeiro; senão qualquer uma não arquivada. */
export async function sessaoProntaParaEnvio(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const listar = (soWorking: boolean, ignorarArquivadas: boolean) => {
    let q = supabase
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId);
    if (soWorking) q = q.eq("status", "WORKING");
    if (ignorarArquivadas) q = q.is(ARCHIVED_AT, null);
    return q.order("created_at", { ascending: true }).limit(1);
  };
  const tentar = async (soWorking: boolean) => {
    const { data } = await queryTolerantToMissingArchived(
      () => listar(soWorking, true),
      () => listar(soWorking, false),
    );
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  };
  return (await tentar(true)) ?? (await tentar(false));
}

export type ConexaoEscolhida =
  | { kind: "conexao"; id: string }
  | { kind: "recusa"; motivo: "conexao_nao_encontrada" | "sem_conexao_de_whatsapp" };

/**
 * Por qual conexão uma automação fala com um contato.
 *
 * Medido em produção (2026-09-29): um fluxo guardava no bloco o id de uma
 * conexão que a pessoa excluiu duas semanas antes. Cada execução ABRIA uma
 * conversa nova naquela conexão morta (`ensureConversation` não sabe de
 * arquivamento), o envio falhava com `channel_archived`, e a Caixa de entrada
 * passou a mostrar o mesmo cliente em várias linhas — lido pelo dono como
 * "contato duplicado".
 *
 * A ordem:
 *   1. a conexão escolhida, se é desta organização e não foi excluída;
 *   2. a conexão em que o PRÓPRIO contato escreveu por último — responder pelo
 *      número que o cliente usou mantém a conversa numa linha só;
 *   3. a primeira conexão viva da organização.
 *
 * Conexão escolhida que não é desta organização continua RECUSA, nunca queda
 * para outra: é id copiado de outro cliente, e não uma conexão que morreu.
 */
export async function conexaoParaOContato(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string | null,
  escolhida: string | null,
): Promise<ConexaoEscolhida> {
  if (escolhida !== null) {
    const { data } = await queryTolerantToMissingArchived(
      () =>
        supabase
          .from("channel_sessions")
          .select(`id, ${ARCHIVED_AT}`)
          .eq("id", escolhida)
          .eq("organization_id", organizationId)
          .maybeSingle(),
      () =>
        supabase
          .from("channel_sessions")
          .select("id")
          .eq("id", escolhida)
          .eq("organization_id", organizationId)
          .maybeSingle(),
    );
    const linha = data as { id: string; archived_at?: string | null } | null;
    if (linha === null) return { kind: "recusa", motivo: "conexao_nao_encontrada" };
    if (!linha.archived_at) return { kind: "conexao", id: linha.id };
  }

  if (contactId !== null) {
    const { data: conversas } = await supabase
      .from("conversations")
      .select("channel_session_id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("is_group", false)
      .not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false })
      .limit(5);
    const ids = ((conversas as Array<{ channel_session_id: string }> | null) ?? []).map(
      (c) => c.channel_session_id,
    );
    if (ids.length > 0) {
      const { data: vivas } = await queryTolerantToMissingArchived(
        () =>
          supabase
            .from("channel_sessions")
            .select("id")
            .eq("organization_id", organizationId)
            .in("id", ids)
            .is(ARCHIVED_AT, null),
        () =>
          supabase
            .from("channel_sessions")
            .select("id")
            .eq("organization_id", organizationId)
            .in("id", ids),
      );
      const vivasIds = new Set(((vivas as Array<{ id: string }> | null) ?? []).map((s) => s.id));
      const daUltimaConversa = ids.find((id) => vivasIds.has(id));
      if (daUltimaConversa !== undefined) return { kind: "conexao", id: daUltimaConversa };
    }
  }

  const padrao = await sessaoProntaParaEnvio(supabase, organizationId);
  return padrao === null
    ? { kind: "recusa", motivo: "sem_conexao_de_whatsapp" }
    : { kind: "conexao", id: padrao };
}

export async function ensureConversation(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
  channelSessionId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    if (OPEN_STATUSES.includes(row.status)) return row.id;
    const { error: reopenErr } = await admin
      .from("conversations")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("organization_id", organizationId);
    if (reopenErr) throw new Error(reopenErr.message);
    return row.id;
  }

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      channel: "whatsapp",
      status: "open",
      metadata: { created_by: "automation" },
    })
    .select("id")
    .single();
  if (error || !created) {
    // Corrida: outro processo criou a conversa 1:1 entre o select e o insert.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("channel_session_id", channelSessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (winner) return (winner as { id: string }).id;
    }
    throw new Error(error?.message ?? "conversation_insert_failed");
  }
  return (created as { id: string }).id;
}
