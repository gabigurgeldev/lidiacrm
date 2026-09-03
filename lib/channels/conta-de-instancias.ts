/**
 * CONEXÃO POR CREDENCIAL DE CONTA — a fachada que a rota e a tela enxergam.
 *
 * ═══ Por que existe uma terceira forma de conectar ═══
 *
 * O produto já tinha duas: parear um número lendo QR, e colar as credenciais de
 * UM número oficial. As duas conectam um número por vez, e a segunda exige que o
 * operador vá ao painel da plataforma buscar três valores.
 *
 * Há intermediários que emitem uma chave de CONTA: com ela o CRM pergunta
 * "quais números você tem?" e recebe a lista pronta — oficiais e por QR
 * misturados, cada um com o próprio identificador e estado. O operador escolhe
 * quais quer atender aqui e não redigita nada. É outra forma de conectar, não
 * uma variação da anterior, e por isso tem rota e tela próprias.
 *
 * ═══ Por que a rota fala com este arquivo, e não com o provider ═══
 *
 * Invariante 1 de `docs/doctrine/restricao-de-canal.md`: nenhum arquivo fora de
 * `lib/channels/` pode nomear um provider. A rota
 * (`app/api/v1/channels/account/`) e a tela recebem daqui o rótulo comercial
 * como DADO e as operações já resolvidas. A primeira versão da rota do outro
 * intermediado foi reprovada pelo `lint:channels` por escrever o nome — a
 * catraca funcionando.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, colunaAusenteNoErro, queryTolerantToMissingArchived } from "./archived";
import {
  MODO_OFICIAL,
  MODO_QR,
  PROVIDER_DA_CONTA,
  ROTULO_PARCEIRO_STEVO,
} from "./tipo-de-conexao";
import { reactivateChannelSession } from "./reactivate";
import { env } from "@/lib/env";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import {
  apontarWebhookStevo,
  validarContaStevo,
  type StevoInstancia,
} from "./stevo/instancias";
import { resolveStevoCreds, stevoBaseUrl } from "./stevo/credentials";
import type { ChannelProvider } from "./types";

/**
 * O provider que se conecta desta forma nesta instalação.
 *
 * O valor vem de `tipo-de-conexao.ts` (módulo PURO) porque a tela também precisa
 * dele, e importar deste arquivo a partir de um componente `"use client"`
 * arrastaria o cliente do Supabase e a cifra para o bundle do navegador — o
 * build quebra com "next/headers ... only available in Server Components".
 */
export const ACCOUNT_CHANNEL_PROVIDER: ChannelProvider = PROVIDER_DA_CONTA;

/**
 * Como ele se chama PARA O USUÁRIO. Vem do servidor porque a tela não pode
 * nomear provider — e porque quem instala reconhece a marca que contratou.
 */
export const ACCOUNT_CHANNEL_LABEL = ROTULO_PARCEIRO_STEVO;

/** Uma instância como a tela a mostra. Sem nada do vocabulário do provider. */
export interface InstanciaDaConta {
  id: string;
  nome: string | null;
  telefone: string | null;
  /** Estado cru do provedor — a tela mostra, não interpreta. */
  situacao: string | null;
  conectada: boolean;
  /** `oficial` = janela de 24h; `qr` = texto livre com risco de banimento. */
  modo: typeof MODO_OFICIAL | typeof MODO_QR;
  /** Já existe linha ativa desta instância nesta organização? */
  importada: boolean;
}

export type ValidacaoDaContaDeInstancias =
  | { ok: true; instancias: InstanciaDaConta[] }
  | { ok: false; motivo: string };

function comoNaTela(i: StevoInstancia, importadas: Set<string>): InstanciaDaConta {
  return {
    id: i.id,
    // Nome do painel primeiro, nome do perfil do WhatsApp depois: o primeiro é
    // como o operador batizou, o segundo é como o número se apresenta. Cair no
    // telefone seria repetir a coluna ao lado.
    nome: i.nome ?? i.nomeDoPerfil,
    telefone: i.telefone,
    situacao: i.status,
    conectada: i.conectada,
    modo: i.oficial ? MODO_OFICIAL : MODO_QR,
    importada: importadas.has(i.id),
  };
}

/** Uma conexão já importada, como a tela a lê. */
export interface ConexaoDaConta {
  /** Id da linha de `channel_sessions` — é por ele que se exclui. */
  id: string;
  /** Id da instância no painel do provedor. */
  instanceId: string | null;
  nome: string | null;
  telefone: string | null;
  status: string | null;
  modo: string | null;
}

/**
 * As conexões desta forma que a organização já tem.
 *
 * Mora aqui e não na rota porque a consulta cita COLUNA de provider
 * (`stevo_instance_id`), e o `lint:channels` reprova isso fora desta pasta — o
 * que ele fez, de fato, com a primeira versão da rota. A catraca funcionando.
 */
export async function conexoesDaConta(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConexaoDaConta[]> {
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, stevo_instance_id, display_name, phone_number, status, provider_mode")
      .eq("organization_id", organizationId)
      .eq("provider", ACCOUNT_CHANNEL_PROVIDER)
      .order("created_at", { ascending: true });
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null),
    () => base(),
  );

  const linhas = (data ?? []) as Array<{
    id: string;
    stevo_instance_id: string | null;
    display_name: string | null;
    phone_number: string | null;
    status: string | null;
    provider_mode: string | null;
  }>;

  return linhas.map((l) => ({
    id: l.id,
    instanceId: l.stevo_instance_id,
    nome: l.display_name,
    telefone: l.phone_number,
    status: l.status,
    modo: l.provider_mode,
  }));
}

/** Os identificadores já importados (linhas ATIVAS) desta organização. */
export async function instanciasImportadas(
  admin: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const base = () =>
    admin
      .from("channel_sessions")
      .select("stevo_instance_id")
      .eq("organization_id", organizationId)
      .eq("provider", ACCOUNT_CHANNEL_PROVIDER);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null),
    () => base(),
  );
  const linhas = (data ?? []) as Array<{ stevo_instance_id: string | null }>;
  return new Set(linhas.map((l) => l.stevo_instance_id).filter((id): id is string => Boolean(id)));
}

/**
 * A chave presta? Quais instâncias ela alcança? Quais já estão aqui?
 *
 * **Valida ANTES de gravar**, como o canal oficial e o outro intermediado:
 * gravar primeiro e descobrir depois é o que faz o operador achar que conectou e
 * só entender que não na primeira mensagem que não sai.
 */
export async function validarContaDeInstancias(
  admin: SupabaseClient,
  input: { organizationId: string; apiKey: string },
): Promise<ValidacaoDaContaDeInstancias> {
  const r = await validarContaStevo({ apiKey: input.apiKey, baseUrl: stevoBaseUrl() });
  if (!r.ok) return { ok: false, motivo: r.motivo };

  const importadas = await instanciasImportadas(admin, input.organizationId);
  return { ok: true, instancias: r.instancias.map((i) => comoNaTela(i, importadas)) };
}

export interface DesfechoDaImportacao {
  id: string;
  /** Nome com que a linha ficou — é o que aparece nos seletores. */
  nome: string;
  /** O webhook foi apontado para esta instalação? */
  recebendo: boolean;
  /** Por que não ficou recebendo — frase pronta pra tela. Só com `recebendo:false`. */
  motivo?: string;
}

/**
 * Base pública desta instalação — vai para o webhook registrado no provedor.
 *
 * Mora aqui e não numa rota porque passa a ter dois chamadores
 * (`account/instances` e `account/instances/[id]/webhook`), e duplicar uma
 * função que decide para onde a Stevo entrega mensagem é o tipo de cópia que
 * diverge sem ninguém notar.
 *
 * Lida de `env.*` e NÃO de `process.env.NEXT_PUBLIC_APP_URL` direto: variáveis
 * `NEXT_PUBLIC_` são substituídas no BUILD, e a imagem
 * genérica do self-host é construída com `https://placeholder.invalid`
 * (Dockerfile). Lendo do `process.env`, o webhook seria registrado apontando
 * para o nada — e o canal enviaria sem nunca receber, sem erro em lugar
 * nenhum.
 */
export function publicBase(req: { headers: Headers; nextUrl: { protocol: string; host: string } }): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  return usavel ?? req.headers.get("origin") ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

/**
 * Importa as instâncias escolhidas: uma linha de `channel_sessions` por
 * instância, com o webhook já apontado para cá.
 *
 * ─── Por que o webhook é apontado por nós, e não pelo operador ─────────────
 *
 * Porque o endereço carrega o `webhook_path_token` da linha — segredo gerado
 * aqui, que o operador não tem por que ver nem colar. É também o passo que faz a
 * conexão terminar FUNCIONANDO: o canal oficial exige essa etapa manual no
 * painel da Meta, e é exatamente onde as instalações emperram (o canal envia,
 * não recebe, e a janela de 24h nunca abre).
 *
 * ─── Webhook recusado NÃO desfaz a importação ─────────────────────────────
 *
 * O canal já consegue ENVIAR. Um canal que envia e não recebe é ruim, mas é
 * melhor que canal nenhum — desde que a tela diga, que é para isso que
 * `recebendo` sobe no desfecho.
 */
export async function importarInstancias(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    requestId: string;
    apiKey: string;
    /** URL pública desta instalação, sem barra no fim. */
    baseDoWebhook: string;
    instancias: InstanciaDaConta[];
  },
): Promise<{ ok: true; desfechos: DesfechoDaImportacao[] } | { ok: false; motivo: string }> {
  const cifrada = await encryptWebhookSecret(admin, input.apiKey);
  if (!cifrada) {
    // Sem a GUC de cifra, gravar a chave em claro seria pior que recusar. O
    // operador precisa saber que falta uma configuração de SERVIDOR — não é algo
    // que ele conserte colando outra chave.
    return {
      ok: false,
      motivo:
        "cifra indisponível nesta instalação (GUC app.nuvemshop_oauth_key ausente) — a chave não foi gravada",
    };
  }

  const desfechos: DesfechoDaImportacao[] = [];

  for (const inst of input.instancias) {
    const nome = inst.nome ?? inst.telefone ?? `Instância ${inst.id.slice(0, 8)}`;

    // ─── DUAS buscas, e a razão é uma trava de banco ────────────────────────
    //
    // O óbvio seria uma consulta só por (org, provider, instância) e decidir
    // depois se a linha estava arquivada. Ela quebra num caso real: o índice
    // único da 0206 é PARCIAL (`where archived_at is null`), então UMA ativa e
    // UMA arquivada com o mesmo identificador coexistem legitimamente — e
    // `maybeSingle()` com duas linhas devolve `data: null` + `PGRST116`, não a
    // primeira. Com o erro descartado, o desfecho seria um INSERT que a trava
    // recusa, e a importação falharia com erro de constraint num caminho que
    // deveria só ressuscitar.
    //
    // Cada busca recorta um lado da partição, e é isso que a varredura de
    // `tests/unit/canal-consulta-por-organizacao.test.ts` cobra. A ATIVA vem
    // primeiro porque ela é a linha em uso; a arquivada só interessa quando não
    // há ativa, e aí é ela que voltará à vida.
    const porInstancia = (colunas: string) =>
      admin
        .from("channel_sessions")
        .select(colunas)
        .eq("organization_id", input.organizationId)
        .eq("provider", ACCOUNT_CHANNEL_PROVIDER)
        .eq("stevo_instance_id", inst.id);

    const { data: ativaRaw } = await queryTolerantToMissingArchived(
      () => porInstancia("id, webhook_path_token").is(ARCHIVED_AT, null).maybeSingle(),
      () => porInstancia("id, webhook_path_token").maybeSingle(),
    );
    let existente = ativaRaw as
      | { id: string; webhook_path_token: string; archived_at?: string | null }
      | null;

    if (!existente) {
      // O lado arquivado NÃO tem índice único — pode ter mais de uma linha do
      // mesmo identificador, acumulada por exclusões sucessivas. Por isso
      // `limit(1)` com leitura do primeiro, e nunca `maybeSingle()`: a mais
      // recente é a que carrega o histórico que interessa ressuscitar.
      //
      // A tolerância aqui é escrita à mão, e não com
      // `queryTolerantToMissingArchived`: no clone sem a coluna (0106) não
      // existe "arquivada" nenhuma, e a busca acima já devolveu tudo que havia.
      // A alternativa certa é NÃO procurar — e o helper exige duas consultas de
      // verdade, com o mesmo tipo de retorno.
      const arquivadas = await porInstancia(`id, webhook_path_token, ${ARCHIVED_AT}`)
        .not(ARCHIVED_AT, "is", null)
        .order(ARCHIVED_AT, { ascending: false })
        .limit(1);
      const linhas = colunaAusenteNoErro(arquivadas.error, ARCHIVED_AT)
        ? []
        : ((arquivadas.data ?? []) as unknown as Array<{
            id: string;
            webhook_path_token: string;
            archived_at?: string | null;
          }>);
      existente = linhas[0] ?? null;
    }

    const linha = {
      organization_id: input.organizationId,
      provider: ACCOUNT_CHANNEL_PROVIDER,
      stevo_instance_id: inst.id,
      stevo_token_encrypted: cifrada,
      // ⚠️ A MODALIDADE é gravada aqui e não deduzida depois: é ela que decide
      // se vale a janela de 24h ou o anti-ban, e o provedor só a informa neste
      // momento (`is_official_api` na listagem).
      provider_mode: inst.modo,
      display_name: nome,
      phone_number: inst.telefone ? `+${inst.telefone.replace(/\D/g, "")}` : null,
      status: inst.conectada ? "WORKING" : "STOPPED",
    };

    let tokenDoWebhook = existente?.webhook_path_token ?? null;

    if (existente) {
      const { error } = await reactivateChannelSession(
        admin,
        {
          organizationId: input.organizationId,
          channelSessionId: existente.id,
          archivedAt: existente.archived_at ?? null,
        },
        linha,
        {
          userId: input.userId,
          requestId: input.requestId,
          metadata: { provider: ACCOUNT_CHANNEL_PROVIDER, instancia: inst.id },
        },
      );
      if (error) return { ok: false, motivo: error.message ?? "channel_session_write_failed" };
    } else {
      const { data: criada, error } = await admin
        .from("channel_sessions")
        .insert({ ...linha, webhook_secret_encrypted: cifrada })
        .select("webhook_path_token")
        .maybeSingle();
      if (error) return { ok: false, motivo: error.message ?? "channel_session_write_failed" };
      tokenDoWebhook = (criada as { webhook_path_token: string } | null)?.webhook_path_token ?? null;
    }

    const webhook = tokenDoWebhook
      ? await apontarWebhookStevo({
          apiKey: input.apiKey,
          baseUrl: stevoBaseUrl(),
          instanceId: inst.id,
          // A rota NEUTRA de webhook — o caminho não cita provider nenhum.
          url: `${input.baseDoWebhook}/api/v1/webhooks/channel/${tokenDoWebhook}`,
          oficial: inst.modo === MODO_OFICIAL,
        })
      : { ok: false as const, motivo: "linha sem webhook_path_token — não deveria acontecer" };

    desfechos.push({ id: inst.id, nome, recebendo: webhook.ok, motivo: webhook.motivo });
  }

  return { ok: true, desfechos };
}

/**
 * Tenta de novo, SEM reimportar — para quando o operador corrige do lado da
 * Stevo (ex.: adiciona o escopo `instances:manage` na API Key) e só precisa
 * que o CRM avise a Stevo de novo. Reaproveita a chave já cifrada na linha via
 * `resolveStevoCreds`: o operador não cola nada de novo.
 */
export async function reapontarWebhookDaConta(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; baseDoWebhook: string },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const base = () =>
    admin
      .from("channel_sessions")
      .select(`id, stevo_instance_id, webhook_path_token, provider_mode, ${ARCHIVED_AT}`)
      .eq("organization_id", input.organizationId)
      .eq("provider", ACCOUNT_CHANNEL_PROVIDER)
      .eq("id", input.channelSessionId);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () =>
      admin
        .from("channel_sessions")
        .select("id, stevo_instance_id, webhook_path_token, provider_mode")
        .eq("organization_id", input.organizationId)
        .eq("provider", ACCOUNT_CHANNEL_PROVIDER)
        .eq("id", input.channelSessionId)
        .maybeSingle(),
  );
  const linha = data as {
    id: string;
    stevo_instance_id: string | null;
    webhook_path_token: string;
    provider_mode: string | null;
  } | null;
  if (!linha || !linha.stevo_instance_id) {
    return { ok: false, motivo: "canal não encontrado" };
  }

  const creds = await resolveStevoCreds(admin, {
    organizationId: input.organizationId,
    instanceId: linha.stevo_instance_id,
  });
  if (!creds) {
    return { ok: false, motivo: "sem credencial gravada para este canal" };
  }

  const r = await apontarWebhookStevo({
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    instanceId: linha.stevo_instance_id,
    url: `${input.baseDoWebhook}/api/v1/webhooks/channel/${linha.webhook_path_token}`,
    oficial: linha.provider_mode === MODO_OFICIAL,
  });
  return r.ok ? { ok: true } : { ok: false, motivo: r.motivo ?? "o provedor recusou" };
}
