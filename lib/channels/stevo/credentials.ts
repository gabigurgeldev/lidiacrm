/**
 * Credenciais do intermediário de CONTA — por sessão, com env como fallback.
 *
 * Mesmo desenho de `../zernio/credentials.ts` e `../meta/credentials.ts`, e de
 * propósito: duas organizações com contas diferentes na mesma instalação é o
 * multi-tenant que o `CLAUDE.md` estabelece desde o dia 1, e um terceiro formato
 * de credencial só faria o self-hoster ter que aprender mais uma coisa.
 *
 * ─── O que é diferente aqui, e importa ──────────────────────────────────────
 *
 * Nos outros dois canais a credencial pertence ao NÚMERO: um token por
 * `phone_number_id`, uma API key por conta conectada. Aqui a credencial é da
 * CONTA inteira (`stevo_sk_…`) e ela dá acesso a TODAS as instâncias — oficiais
 * e por QR — de uma vez. É por isso que a tela de conexão consegue descobrir os
 * números sozinha em vez de pedir um a um.
 *
 * A consequência de segurança é que a mesma chave é gravada em cada linha
 * importada. Guardá-la uma vez só, numa tabela de conta, seria menos repetição —
 * e criaria uma tabela nova cujo ciclo de vida ninguém sabe (o que acontece
 * quando a última instância é excluída?). Repetir a cifra por linha mantém a
 * regra que já existe: excluir o canal apaga a credencial DELE, e a rotação da
 * chave passa pela mesma tela que a gravou.
 *
 * A cifra usa as MESMAS RPCs do resto do repo (`fn_encrypt_oauth` /
 * `fn_decrypt_oauth`, ver `lib/webhooks/secrets.ts`).
 *
 * ─── Por que a busca leva a ORGANIZAÇÃO junto (issue #236) ──────────────────
 *
 * Mesma razão dos irmãos, e o mesmo desfecho medido: `stevo_instance_id` é
 * identificador do PROVIDER, duas organizações podem ter o mesmo por
 * configuração legítima (agência, migração entre organizações), e
 * `maybeSingle()` com duas linhas devolve `data: null` + `PGRST116`. Com o
 * `error` descartado, as duas passariam a enviar pela conta do `.env`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface StevoCredentials {
  /** A instância dentro da conta — o `sessionRef` deste canal. */
  instanceId: string;
  /** A chave da CONTA (`stevo_sk_…`), que alcança todas as instâncias dela. */
  apiKey: string;
  baseUrl: string;
  /** De onde veio — aparece no log de diagnóstico, nunca no payload. */
  source: "session" | "env";
}

/** A chave da busca. `organizationId` NÃO é decoração: ver o cabeçalho. */
export interface StevoCredsLookup {
  /** Resolvido de fonte confiável (sessão, linha já escopada, token do webhook). */
  organizationId: string;
  /** `channel_sessions.stevo_instance_id`. */
  instanceId: string;
}

/**
 * Base da API de gestão da conta. Explícita e sobrescrevível: um teste de
 * integração precisa apontar para um receiver local sem editar código.
 */
export function stevoBaseUrl(): string {
  return process.env.STEVO_API_BASE_URL ?? "https://openapi.stevo.chat";
}

/**
 * Base da API OFICIAL do intermediário — outro host, outro esquema de auth.
 *
 * Separada porque é mesmo outro serviço: a gestão fala por chave de conta e
 * responde sobre instâncias; esta fala por token DA INSTÂNCIA e responde sobre
 * templates e mídia da WABA. Misturar as duas numa base só faria a primeira
 * chamada errada retornar 404 sem dizer por quê.
 */
export function stevoBaseUrlOficial(): string {
  return process.env.STEVO_OFFICIAL_API_BASE_URL ?? "https://apimeta.shurima.cloud";
}

/**
 * Credencial do ambiente. `null` quando não configurada — o chamador trata como
 * canal não conectado (noop), nunca como erro.
 */
export function stevoCredsFromEnv(): Pick<StevoCredentials, "apiKey" | "baseUrl"> | null {
  const apiKey = process.env.STEVO_API_KEY;
  if (!apiKey) return null;
  return { apiKey, baseUrl: stevoBaseUrl() };
}

/**
 * Credencial gravada na sessão DESTA ORGANIZAÇÃO que atende esta instância.
 *
 * `null` significa "esta sessão não tem chave gravada" — o chamador cai no env.
 * NÃO significa erro.
 *
 * **LANÇA quando a consulta falha**, pela razão do cabeçalho: descartar o
 * `error` foi metade do defeito da issue #236.
 */
export async function stevoCredsForInstance(
  admin: SupabaseClient,
  lookup: StevoCredsLookup,
): Promise<StevoCredentials | null> {
  const { organizationId, instanceId } = lookup;
  if (!organizationId || !instanceId) return null;

  // `organization_id` À MÃO (service role bypassa RLS) e `archived_at is null`
  // pelo MESMO recorte do índice único `channel_sessions_stevo_instance_id_ativo_unique`
  // (migration 0206): fora do recorte a trava do banco não alcança, e a busca
  // deixaria de ser exata exatamente onde ninguém a garante.
  const base = () =>
    admin
      .from("channel_sessions")
      .select("stevo_instance_id, stevo_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("stevo_instance_id", instanceId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    throw new Error(
      `stevo_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const cifrado = data?.stevo_token_encrypted;
  if (!data || !cifrado) return null;

  const apiKey = await decryptWebhookSecret(admin, cifrado as unknown as string);
  // Decifra que falha devolve null: a chave (GUC) pode não estar configurada
  // nesta instalação. Cair no env é melhor que derrubar o envio — e o `source`
  // no retorno deixa a diferença visível para quem depura.
  if (!apiKey) return null;

  return {
    instanceId: data.stevo_instance_id as string,
    apiKey,
    baseUrl: stevoBaseUrl(),
    source: "session",
  };
}

/**
 * A credencial em vigor para esta instância: **sessão primeiro, env como fallback**.
 *
 * A ordem é sessão-primeiro de propósito: com a chave gravada, o env deixa de
 * ter efeito. Se fosse o contrário, um env esquecido silenciaria a configuração
 * da tela e o operador não entenderia por que nada mudou.
 */
export async function resolveStevoCreds(
  admin: SupabaseClient,
  lookup: StevoCredsLookup,
): Promise<StevoCredentials | null> {
  const daSessao = await stevoCredsForInstance(admin, lookup);
  if (daSessao) return daSessao;
  const doEnv = stevoCredsFromEnv();
  return doEnv ? { ...doEnv, instanceId: lookup.instanceId, source: "env" } : null;
}
