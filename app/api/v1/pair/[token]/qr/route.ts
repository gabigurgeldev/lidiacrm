/**
 * GET /api/v1/pair/[token]/qr — PÚBLICA, sem sessão. A imagem do QR.
 *
 * Proxy do transporte, como a rota autenticada irmã
 * (`/api/v1/channel-sessions/[id]/qr`), e pela mesma razão: o `<img>` do
 * browser não pode carregar a API key do transporte. Aqui isso pesa mais — o
 * browser é o do CLIENTE, fora da organização.
 *
 * O corpo é vazio em toda recusa porque quem consome isto é um `<img>`; o
 * cabeçalho `x-pair-state` é para quem depura.
 */
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { canalParaParear, qrDoTransporte } from "@/lib/channels/pareamento/canal";
import { lerLinkDePareamento } from "@/lib/channels/pareamento/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O QR renova a cada 15s = ~120 no prazo inteiro. 40/min dá folga de 10×. */
const TETO_POR_MINUTO = 40;

function recusa(estado: string, status: number): NextResponse {
  return new NextResponse(null, { status, headers: { "x-pair-state": estado } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const limite = await checkRateLimit(`pair:qr:${token.slice(0, 32)}`, TETO_POR_MINUTO, 60);
  if (!limite.allowed) return recusa("rate-limited", 429);

  const admin = createAdminClient();

  let leitura;
  try {
    leitura = await lerLinkDePareamento(admin, token);
  } catch {
    return recusa("unavailable", 503);
  }
  // Um só estado para fora: inexistente, expirado, cancelado e usado são
  // indistinguíveis aqui. Quem precisa da diferença é a página, e ela a pega no
  // `/status`, que só a revela para token que existe.
  if (!leitura.ok) return recusa("invalid", 404);

  const canal = await canalParaParear(admin, leitura.link.organizationId, leitura.link.channelSessionId);
  if (!canal.ok) {
    // Canal excluído no meio do caminho responde como link inválido; canal sem
    // QR (virou oficial depois do link criado) tem estado próprio.
    return canal.motivo === "sem_qr" ? recusa("no-session", 409) : recusa("invalid", 404);
  }

  const qr = await qrDoTransporte(canal.sessionRef);
  if (!qr.ok) {
    return new NextResponse(null, {
      status: qr.status,
      headers: { "x-pair-state": qr.motivo },
    });
  }

  return new NextResponse(qr.corpo, {
    status: 200,
    headers: { "content-type": qr.contentType, "cache-control": "no-store, max-age=0" },
  });
}
