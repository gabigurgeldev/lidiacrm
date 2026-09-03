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

import { ARCHIVED_AT, consultaTolerante, queryTolerantToMissingArchived } from "../archived";
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

/** A coluna que a migration 0210 acrescentou. Nome em um lugar só. */
const COLUNA_DO_TOKEN_OFICIAL = "stevo_official_token_encrypted";

/**
 * Por onde esta instância envia — resolvido em UMA consulta.
 *
 * ─── Por que existem dois transportes ───────────────────────────────────────
 *
 *   chave da conta (`stevo_sk_…`) → `openapi.stevo.chat`   → gestão + proxy
 *   token da instância            → `apimeta.shurima.cloud` → envio da Oficial
 *
 * O proxy da gestão anuncia servir as duas modalidades, e serve — mas para uma
 * instância oficial ele responde `409 not_ready` com "sem token — conecte
 * primeiro", porque a Oficial não tem servidor de instância para ele proxiar.
 * Medido na conta de produção: `GET /v1/instances/{id}` devolve `token: null` e
 * `server_url: null` para TODA instância `is_official_api: true`, e os dois
 * preenchidos para toda SM v2. O token do gateway não é descobrível por API
 * nenhuma — só o operador o vê no painel. Por isso ele é COLADO, e por isso
 * mora numa coluna nossa.
 *
 * ─── Por que UMA consulta, e não duas ───────────────────────────────────────
 *
 * As duas credenciais moram na MESMA linha e se buscam pela MESMA chave. A
 * primeira versão disto perguntava duas vezes, e a segunda pergunta caía em
 * todo envio por QR — o caminho mais quente do produto — para ouvir "não tem
 * token de gateway" que a primeira já teria dito.
 *
 * ─── Por que tolerante à coluna ausente ─────────────────────────────────────
 *
 * Porque esta função decide TODO envio deste canal, e a coluna nasceu na 0210.
 * Um clone que suba o código antes do schema receberia 42703 aqui e perderia o
 * envio por QR junto — que funcionava antes e não tem nada a ver com a coluna
 * nova. Sem a coluna, o desfecho é exatamente o de antes dela existir: proxy.
 * `consultaTolerante` é o mesmo helper que o seletor de números já usa para
 * `provider`, e ele exige que a MENSAGEM nomeie a coluna — erro de verdade
 * continua subindo.
 */
export type EnvioStevo =
  | { transporte: "gateway"; token: string }
  | { transporte: "proxy"; creds: StevoCredentials };

export async function resolveEnvioStevo(
  admin: SupabaseClient,
  lookup: StevoCredsLookup,
): Promise<EnvioStevo | null> {
  const { organizationId, instanceId } = lookup;
  if (!organizationId || !instanceId) return null;

  // `organization_id` À MÃO (service role bypassa RLS) e o mesmo recorte de
  // `archived_at` do índice único — ver o cabeçalho do arquivo, issue #236.
  const base = (colunas: string) => () =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("stevo_instance_id", instanceId);
  const COM = `stevo_instance_id, stevo_token_encrypted, ${COLUNA_DO_TOKEN_OFICIAL}`;
  const SEM = "stevo_instance_id, stevo_token_encrypted";

  const { data, error } = await consultaTolerante(
    COLUNA_DO_TOKEN_OFICIAL,
    () =>
      queryTolerantToMissingArchived(
        () => base(COM)().is(ARCHIVED_AT, null).maybeSingle(),
        () => base(COM)().maybeSingle(),
      ),
    () =>
      queryTolerantToMissingArchived(
        () => base(SEM)().is(ARCHIVED_AT, null).maybeSingle(),
        () => base(SEM)().maybeSingle(),
      ),
  );
  if (error) {
    // LANÇA de propósito: descartar o `error` foi metade do defeito da #236, e
    // aqui o silêncio mandaria pela conta do `.env` de outra organização.
    throw new Error(
      `stevo_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const linha = data as {
    stevo_instance_id?: string | null;
    stevo_token_encrypted?: string | null;
    stevo_official_token_encrypted?: string | null;
  } | null;

  // Gateway PRIMEIRO: token de gateway gravado só existe em instância oficial,
  // e para ela o proxy é um 409 certo.
  const doGateway = linha?.stevo_official_token_encrypted;
  if (doGateway) {
    const token = await decryptWebhookSecret(admin, doGateway);
    if (token) return { transporte: "gateway", token };
    // Decifra que falha NÃO vira envio pelo proxy: o canal é oficial, o proxy o
    // recusa, e cair lá trocaria "não consegui decifrar o token" por um 409 que
    // manda o operador reconectar um número que está conectado.
    return null;
  }

  const cifrada = linha?.stevo_token_encrypted;
  const daSessao = cifrada ? await decryptWebhookSecret(admin, cifrada) : null;
  if (daSessao) {
    return {
      transporte: "proxy",
      creds: {
        instanceId: linha?.stevo_instance_id ?? instanceId,
        apiKey: daSessao,
        baseUrl: stevoBaseUrl(),
        source: "session",
      },
    };
  }

  // Sessão primeiro, env como fallback — a mesma ordem de `resolveStevoCreds`,
  // e pela mesma razão: com a chave gravada, o env deixa de ter efeito.
  const doEnv = stevoCredsFromEnv();
  return doEnv
    ? { transporte: "proxy", creds: { ...doEnv, instanceId, source: "env" } }
    : null;
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
