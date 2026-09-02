/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia no WAHA). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import {
  ARCHIVED_AT,
  consultaTolerante,
  queryTolerantToMissingArchived,
} from "@/lib/channels/archived";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

/**
 * As colunas que TODO banco tem, por antigo que seja.
 *
 * Separadas de `provider` porque ele é do apêndice e um clone pode não ter — e
 * um `select` que nomeia coluna inexistente devolve 42703, lista vazia, e a
 * tela lê isso como "nenhum número conectado". Ver `consultaTolerante`.
 */
const CHANNEL_COLUMNS_BASE =
  "id, waha_session_name, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

/**
 * `provider` entra porque o inbox precisa DIZER que tipo de número é cada um —
 * conectado por QR code ou canal oficial da Meta. Antes disto a informação
 * existia no banco e não chegava à tela, e o seletor mostrava dois números
 * indistinguíveis com regras de envio completamente diferentes (a janela de 24h
 * vale para um e não para o outro).
 */
export const CHANNEL_COLUMNS = `${CHANNEL_COLUMNS_BASE}, provider`;

/**
 * `provider_mode` entra pelo MESMO motivo do `provider`, um degrau abaixo: há
 * canal em que a regra de envio não sai da identidade do provider, e sim da
 * modalidade da linha — a mesma conta intermediada hospeda instância oficial
 * (janela de 24h) e número ligado por QR (texto livre, risco de banimento). Sem
 * este campo o selo diria a regra errada em metade dos números desse canal.
 *
 * Terceira camada de tolerância, e não um campo a mais na segunda: a coluna vem
 * da migration 0206 e um clone pode ter `provider` e não ter `provider_mode`.
 * Juntá-los faria a ausência do mais novo derrubar o mais velho, e o seletor
 * perderia o selo dos canais que sempre souberam dizer o que são.
 */
export const CHANNEL_COLUMNS_COM_MODO = `${CHANNEL_COLUMNS}, provider_mode`;

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const base = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId);
  // Canais arquivados sobrevivem só como âncora das FKs RESTRICT
  // (conversations/messages). Para o usuário eles foram excluídos.
  //
  // Tolerante à coluna ausente porque esta é a PRIMEIRA tela de quem já tem
  // número ligado: num clone que subiu o código sem a migration 0106, o filtro
  // devolveria 42703 → 500 → "Nenhum número conectado ainda", convidando o
  // operador a parear de novo um número que já está no ar. Sem a coluna, nada
  // está arquivado, e a lista sem o filtro é a lista certa (ver lib/channels/archived).
  //
  // DUAS tolerâncias ANINHADAS, e a ordem importa: `provider` por fora,
  // `archived_at` por dentro. Ao contrário, um banco sem `provider` cairia na
  // alternativa da camada de fora e perderia junto o filtro de arquivados —
  // canal excluído voltaria à lista, que é regressão de verdade, para consertar
  // uma coluna decorativa. Assim cada ausência custa só a si mesma.
  const consultar = (colunas: string) => () =>
    queryTolerantToMissingArchived(
      () => base(colunas).is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
      () => base(colunas).order("created_at", { ascending: true }),
    );
  // TRÊS tolerâncias aninhadas agora, mesma lógica de antes: `provider_mode`
  // (0206) por fora, `provider` (0087) no meio, `archived_at` (0106) por dentro.
  // Cada ausência custa só a si mesma — um clone sem a mais nova continua
  // recebendo `provider` e o filtro de arquivados.
  //
  // `schemaOutdated` é OR acumulativo entre as camadas (ver `consultaTolerante`),
  // então a faixa de aviso na tela acende para qualquer uma das três.
  const { data, error, schemaOutdated } = await consultaTolerante(
    "provider_mode",
    () =>
      consultaTolerante("provider", consultar(CHANNEL_COLUMNS_COM_MODO), consultar(CHANNEL_COLUMNS_BASE)),
    () => consultaTolerante("provider", consultar(CHANNEL_COLUMNS), consultar(CHANNEL_COLUMNS_BASE)),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(data ?? [], {
    requestId,
    ...(schemaOutdated ? { meta: { schema_outdated: true } } : {}),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const waha = getWahaClient();
  if (!waha) {
    return fail(
      "waha_not_configured",
      "O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.",
      503,
      { requestId },
    );
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  // Nome de sessão único por canal — o hardcode `org_<8>` era 1 número por org.
  const sessionName = `org_${activeOrg.orgId.slice(0, 8)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;

  const { data: created, error: insErr } = await supabase
    .from("channel_sessions")
    .insert({
      organization_id: activeOrg.orgId,
      waha_session_name: sessionName,
      display_name: parsed.data.display_name ?? null,
      engine: "NOWEB",
      webhook_path_token: randomUUID().replace(/-/g, ""),
      webhook_secret_encrypted: Buffer.from([0]),
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
      daily_message_limit: 250,
      metadata: {},
    })
    .select(CHANNEL_COLUMNS)
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "channel_session_insert_failed", 500, { requestId });
  }

  try {
    await waha.startSession(sessionName);
  } catch (err) {
    // Rollback: sem WAHA no ar, não deixamos um canal fantasma preso em STARTING.
    await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", created.id);
    return fail("waha_error", wahaFriendlyError(err), 502, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: created.id,
    requestId,
    metadata: { waha_session_name: sessionName },
  });

  return ok(created, { requestId, status: 201 });
}
