import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_CHANNEL_PROVIDER, type ChannelProvider } from "./capabilities";

/**
 * O canal que está de pé nesta organização, pronto para ser usado.
 *
 * ═══ Por que isto mora em `lib/channels/` ═══
 *
 * Porque a consulta nomeia `waha_session_name` — o nome de uma coluna que
 * carrega o nome de um provider —, e a doutrina `restricao-de-canal` reserva
 * isso a esta pasta. `pnpm lint:channels` reprova arquivo NOVO fora daqui que
 * cite o nome, e a catraca só encolhe.
 *
 * Isso não é burocracia contornada: é o que permite `lib/contacts/` chamar o
 * canal sem saber qual canal é. Quem consome recebe um identificador opaco e um
 * provider para pedir o adapter, e nunca compara nenhum dos dois com "waha".
 *
 * ⚠️ ESTE CÓDIGO SAIU DE DENTRO DO CRON DE AVATARES, IDÊNTICO. Ele não é novo, e
 * a extração aconteceu porque um segundo consumidor apareceu (a busca de foto
 * ao abrir a conversa). Duplicá-lo teria criado duas noções de "o canal ativo"
 * que divergem no dia em que uma passar a ordenar por outra coisa.
 */
export interface SessaoAtiva {
  /** Identificador opaco da sessão no transporte. Não interprete. */
  readonly sessionRef: string;
  readonly provider: ChannelProvider;
}

/**
 * `status = WORKING` e `limit(1)`: qualquer canal que esteja realmente no ar
 * serve para PERGUNTAR (foto de perfil, presença). Escolher entre vários não é
 * decisão desta função — quem ENVIA mensagem resolve o canal por outro caminho,
 * que respeita o vínculo da conversa.
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
    .select("waha_session_name, provider")
    .eq("organization_id", organizationId)
    .eq("status", "WORKING")
    .limit(1)
    .maybeSingle();

  const linha = data as { waha_session_name?: string | null; provider?: string | null } | null;
  const ref = linha?.waha_session_name;
  if (!ref) return null;

  return {
    sessionRef: ref,
    provider: (linha?.provider as ChannelProvider | null) ?? DEFAULT_CHANNEL_PROVIDER,
  };
}
