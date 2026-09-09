import type { SupabaseClient } from "@supabase/supabase-js";

import { type ChannelProvider } from "./capabilities";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef, type ChannelSessionRef } from "./session-ref";

/**
 * O canal por onde PERGUNTAR sobre um contato (foto de perfil, presença).
 *
 * ═══ Por que isto mora em `lib/channels/` ═══
 *
 * Porque nomeia as colunas de ref de cada provider (via `CHANNEL_SESSION_REF_COLUMNS`
 * e `resolveSessionRef`), e a doutrina `restricao-de-canal` reserva isso a esta
 * pasta. `pnpm lint:channels` reprova arquivo NOVO fora daqui que cite o nome, e
 * a catraca só encolhe. Quem consome recebe um identificador opaco e um provider
 * para pedir o adapter, e nunca compara nenhum dos dois com "waha".
 *
 * ⚠️ ESTE ARQUIVO JÁ FOI SÓ-WAHA, e era um bug medido: ele selecionava apenas
 * `waha_session_name` com `limit(1)`, então (a) numa org só-Stevo devolvia `null`
 * (a coluna é nula) e nenhum contato ganhava foto, e (b) numa org com WAHA **e**
 * Stevo, se a linha do Stevo viesse primeiro (sem `order by`), a `waha_session_name`
 * nula fazia devolver `null` — silhueta em TODO contato, mesmo com o WAHA no ar.
 * Agora resolve o ref pelo provider de cada linha, e pula quem não tem ref.
 */
export interface SessaoAtiva {
  /** Identificador opaco da sessão no transporte. Não interprete. */
  readonly sessionRef: string;
  readonly provider: ChannelProvider;
}

type LinhaDeRef = ChannelSessionRef & { status?: string | null };

function paraSessaoAtiva(linha: LinhaDeRef | null): SessaoAtiva | null {
  if (!linha?.provider) return null;
  try {
    const ref = resolveSessionRef(linha);
    return ref ? { sessionRef: ref, provider: linha.provider } : null;
  } catch {
    // Provider fora da união (linha de um clone à frente): não sei endereçar.
    return null;
  }
}

/**
 * A sessão da CONVERSA MAIS RECENTE deste contato — o canal em que ele de fato
 * fala, e portanto o único que sabe a foto dele. Preferir isto a
 * `sessaoAtivaDaOrg` conserta o caso multi-canal: a foto de um contato do WAHA
 * tem que ser perguntada ao WAHA, não a um Stevo que nunca falou com ele.
 *
 * `null` quando o contato não tem conversa com canal resolvível — o chamador cai
 * na sessão ativa da org.
 */
export async function sessaoDaConversaDoContato(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<SessaoAtiva | null> {
  const { data } = await admin
    .from("conversations")
    .select(`last_message_at, channel_sessions:channel_session_id(${CHANNEL_SESSION_REF_COLUMNS}, status)`)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .not("channel_session_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const linha = (data as { channel_sessions?: LinhaDeRef | null } | null)?.channel_sessions ?? null;
  return paraSessaoAtiva(linha);
}

/**
 * Qualquer canal da org que esteja de pé — o FALLBACK quando não se sabe a
 * conversa. Pega a primeira sessão WORKING cujo ref é resolvível (provider-
 * agnóstico), em vez de assumir WAHA.
 *
 * Devolve `null` quando não há canal de pé, e isso é um estado normal: uma
 * organização recém-criada, ou com o número caído, simplesmente não tem a quem
 * perguntar. Quem chama trata como "sem resposta", nunca como erro.
 */
export async function sessaoAtivaDaOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<SessaoAtiva | null> {
  const { data } = await admin
    .from("channel_sessions")
    .select(CHANNEL_SESSION_REF_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("status", "WORKING");

  for (const linha of (data ?? []) as LinhaDeRef[]) {
    const sessao = paraSessaoAtiva(linha);
    if (sessao) return sessao;
  }
  return null;
}
