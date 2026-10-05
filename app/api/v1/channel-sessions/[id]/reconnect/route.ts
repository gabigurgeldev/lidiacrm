/**
 * POST /api/v1/channel-sessions/[id]/reconnect — reconecta um canal caído.
 *
 * Dois modos, porque "caiu" tem duas causas com custos bem diferentes:
 *
 *  - PADRÃO (stop + start): soluço de rede, container reiniciado, sessão que
 *    parou sozinha. As credenciais em `/app/.sessions` continuam válidas e o
 *    engine volta sozinho para WORKING — sem QR, sem incomodar o usuário.
 *  - `{ force: true }` (stop + LOGOUT + start): o aparelho foi desvinculado
 *    pelo celular e o WhatsApp revogou a credencial. Aí o start comum
 *    reaproveita uma credencial morta e a sessão vai direto para FAILED, sem
 *    NUNCA passar por SCAN_QR_CODE — era exatamente esse o buraco em que a tela
 *    ficava presa esperando um QR que nunca vinha. O logout descarta a
 *    credencial e o pareamento recomeça do zero.
 *
 * O padrão é o modo suave de propósito: forçar logout sempre custaria um
 * reescaneamento a cada queda passageira. A UI só oferece o `force` depois que
 * o modo suave falhou.
 *
 * Canal EXCLUÍDO (arquivado) é recusado, não reconectado: subir a sessão de novo
 * no transporte devolveria um canal que recebe e não entrega nada — o webhook, o
 * ingest e o envio filtram `archived_at` e descartariam tudo. Vivo e surdo é pior
 * que desligado. E não há o que "reconectar": a exclusão deslogou o aparelho e
 * apagou a sessão no transporte, então o caminho de volta é conectar um número
 * (que também é o que a mensagem de erro diz).
 *
 * Canal OFICIAL é recusado por outro motivo, e com outro desfecho (422): ele não
 * tem sessão no transporte para parar e subir — `waha_session_name` é NULL nele
 * por CHECK. Reiniciar não é a operação dele; trocar a credencial é.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { reiniciarSessaoDoCanal } from "@/lib/channels/reconectar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const reconnectSchema = z.object({ force: z.boolean().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsedBody = reconnectSchema.safeParse(rawBody ?? {});
  const force = parsedBody.success ? (parsedBody.data.force ?? false) : false;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  // A regra (arquivado, oficial sem sessão, transporte ausente) mora em
  // `lib/channels/reconectar.ts`, compartilhada com o agente de suporte.
  const supabase = await createClient();
  const r = await reiniciarSessaoDoCanal(supabase, { organizationId: activeOrg.orgId, channelSessionId: id, forcar: force });
  if (!r.ok) return fail(r.codigo, r.mensagem, r.http, { requestId });

  void audit({
    action: "channel.reconnected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { waha_session_name: r.nomeSessao, force },
  });

  return ok({ id, status: r.status, force }, { requestId });
}
