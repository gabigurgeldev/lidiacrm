/**
 * Reiniciar a sessão de WhatsApp de um canal — a regra num lugar só.
 *
 * Dois chamadores: a tela (`POST /api/v1/channel-sessions/:id/reconnect`, com
 * sessão do admin) e o agente de suporte (`/suporte/v1/.../acoes/reconectar_canal`,
 * depois do código e do SIM do dono). Os dois têm de recusar as MESMAS coisas
 * — canal arquivado, canal oficial sem sessão, transporte não configurado —
 * com as MESMAS frases; antes desta extração a regra vivia dentro da rota.
 *
 * `forcar` descarta a credencial (obriga a reescanear o QR). O agente de
 * suporte NUNCA passa `forcar`: é irreversível, e quem decide reescanear é
 * quem está com o celular na mão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export type ResultadoDaReconexao =
  | { ok: true; status: string; nomeSessao: string }
  | {
      ok: false;
      codigo: "not_found" | "channel_archived" | "channel_without_session" | "waha_not_configured" | "waha_error";
      mensagem: string;
      http: number;
    };

export async function reiniciarSessaoDoCanal(
  db: SupabaseClient,
  alvo: { organizationId: string; channelSessionId: string; forcar?: boolean },
): Promise<ResultadoDaReconexao> {
  const buscar = (colunas: string) =>
    db
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.channelSessionId)
      .maybeSingle();
  // Tolerante à coluna ausente: num clone sem a migration 0106 nada está
  // arquivado, e exigir a coluna aqui derrubaria a reconexão inteira — que é o
  // socorro de quem está com o número fora do ar.
  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`id, waha_session_name, ${ARCHIVED_AT}`),
    () => buscar("id, waha_session_name"),
  );
  const session = sessionRaw as { id: string; waha_session_name: string | null; archived_at?: string | null } | null;
  if (!session) return { ok: false, codigo: "not_found", mensagem: "Canal não encontrado.", http: 404 };
  if (session.archived_at) {
    return {
      ok: false,
      codigo: "channel_archived",
      mensagem:
        "Este número foi excluído da Central de Conexões — reconectar não o traz de volta. Conecte um número para voltar a atender.",
      http: 409,
    };
  }
  // O nome da sessão é NULL no canal oficial (CHECK
  // `channel_sessions_provider_ref_check`): não há sessão para reiniciar.
  const nomeSessao = session.waha_session_name;
  if (!nomeSessao) {
    return {
      ok: false,
      codigo: "channel_without_session",
      mensagem:
        "Este canal é o oficial (API da plataforma): ele não tem sessão de WhatsApp para reiniciar. Se parou de entregar, atualize a credencial na tela do canal oficial.",
      http: 422,
    };
  }

  const waha = getWahaClient();
  if (!waha) {
    return {
      ok: false,
      codigo: "waha_not_configured",
      mensagem:
        "O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.",
      http: 503,
    };
  }

  try {
    await waha.stopSession(nomeSessao);
    if (alvo.forcar) await waha.logoutSession(nomeSessao);
    const remote = (await waha.startSession(nomeSessao)) as { status?: string };
    await db
      .from("channel_sessions")
      .update({
        status: "STARTING",
        last_status_change_at: new Date().toISOString(),
        consecutive_health_fails: 0,
      })
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.channelSessionId);
    return { ok: true, status: remote.status ?? "STARTING", nomeSessao };
  } catch (err) {
    return { ok: false, codigo: "waha_error", mensagem: wahaFriendlyError(err), http: 502 };
  }
}
