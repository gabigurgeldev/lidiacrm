// app/api/v1/messages/[id]/media/route.ts
/**
 * GET /api/v1/messages/[id]/media — acesso autenticado à mídia da mensagem.
 * Persistida → 302 pra signed URL (TTL 1h) do bucket whatsapp-media.
 * Ainda não persistida (janela até o worker rodar) → proxy dos bytes do WAHA.
 * A URL desta rota é usada diretamente como src de <img>/<video>/<audio>
 * (cookie de sessão vai junto por ser same-origin; RLS decide o acesso).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { midiaCompartilhadaDaMensagem } from "@/lib/messaging/media/midia-compartilhada";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_S = 3600;

/**
 * Quanto o browser guarda o próprio redirect — a mesma razão do avatar
 * (`app/api/v1/contacts/[id]/avatar/route.ts`): sem isto, cada <img>/<audio>
 * do hilo refazia sessão + organização + SELECT + `createSignedUrl` a cada
 * render, e o hilo é relido a cada mensagem que chega.
 *
 * `private` porque a autorização é da sessão; MENOR que SIGNED_URL_TTL_S
 * porque um redirect guardado além da assinatura aponta para URL vencida. A
 * folga de 10 min cobre o redirect seguido no fim da janela.
 */
const BROWSER_CACHE_S = 3000;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: messageId } = await ctx.params;
  const supabase = await createClient();

  const user = await loadAuthUser();
  if (!user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  // Client de sessão: RLS garante que a mensagem pertence a uma org do usuário.
  // Filtro explícito de organization_id por doutrina (defense-in-depth).
  const { data: msg, error } = await supabase
    .from("messages")
    .select("id, media_url, media_mime, media_storage_path, channel_session_id, metadata")
    .eq("id", messageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) {
    return fail("internal_error", "Erro ao buscar mensagem.", 500, { requestId });
  }
  // Mídia COMPARTILHADA: o arquivo do disparo em massa ou a foto do acervo que
  // o agente enviou — um arquivo da organização, apontado pela metadata de cada
  // mensagem (ver `OpcoesDeEnvio` no handler de envio). O helper só devolve
  // caminho da pasta da origem da PRÓPRIA organização — a assinatura usa a
  // service role, que não passa pela RLS do Storage.
  const midiaCompartilhada = midiaCompartilhadaDaMensagem(msg?.metadata, activeOrg.orgId)?.path ?? null;

  if (!msg || (!msg.media_storage_path && !msg.media_url && !midiaCompartilhada)) {
    return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
  }

  const caminhoAssinavel = msg.media_storage_path ?? midiaCompartilhada;
  if (caminhoAssinavel) {
    const admin = createAdminClient();
    const { data: signed, error: signErr } = await admin.storage
      .from("whatsapp-media")
      .createSignedUrl(caminhoAssinavel, SIGNED_URL_TTL_S);
    if (!signErr && signed?.signedUrl) {
      const response = NextResponse.redirect(signed.signedUrl, 302);
      response.headers.set("X-Request-Id", requestId);
      response.headers.set("Cache-Control", `private, max-age=${BROWSER_CACHE_S}`);
      return response;
    }
    if (signErr) {
      console.error("[messages.media] createSignedUrl failed", signErr.message);
    }
  }

  // ── Fallback: o worker ainda não persistiu ──────────────────────────────────
  //
  // O drain é cron de minuto a minuto, então esta janela é diária: quem abre a
  // conversa antes da persistência cai aqui. O browser não alcança o transporte
  // nem tem a credencial, por isso o proxy é server-side.
  //
  // Pelo ADAPTER, não por uma função fixa. Esta era literalmente a linha que o
  // conserto do worker removeu de lá e esqueceu aqui: com `fetchWahaMedia` em
  // duro, o path de um anexo do canal intermediado era procurado dentro do
  // contêiner do canal por QR — 404, e a tela dizia "mídia indisponível".
  if (msg.media_url) {
    try {
      const admin = createAdminClient();
      const { data: sessao } = await admin
        .from("channel_sessions")
        .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
        .eq("organization_id", activeOrg.orgId)
        .eq("id", msg.channel_session_id)
        .maybeSingle();

      const adapter = getAdapter(
        ((sessao?.provider as string) ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider,
      );
      const sessionRef = sessao ? resolveSessionRef(sessao as unknown as ChannelSessionRef) : null;
      if (!adapter.fetchInboundMedia || !sessionRef) {
        // Canal sem mídia de entrada não é defeito: é estado normal. 404 diz a
        // verdade ("não há o que servir"); 502 acusaria uma falha inexistente.
        return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
      }

      const media = await adapter.fetchInboundMedia({
        organizationId: activeOrg.orgId,
        sessionRef,
        url: msg.media_url,
        hintMime: msg.media_mime,
      });
      return new Response(new Uint8Array(media.buffer), {
        status: 200,
        headers: {
          "Content-Type": media.mime,
          "Cache-Control": "private, max-age=60",
          "X-Request-Id": requestId,
        },
      });
    } catch {
      return fail("bad_gateway", "Mídia indisponível no momento.", 502, { requestId });
    }
  }

  return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
}
