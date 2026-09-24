/**
 * Autenticação das chamadas do Back Office de afiliados → este CRM (rotas `/backoffice/*`).
 *
 * O Back Office assina `"{X-Timestamp}.{corpo cru}"` com HMAC-SHA256 usando
 * `BACKOFFICE_OUTBOUND_SECRET` e manda em `X-Backoffice-Signature: sha256=<hex>`.
 * Timestamp fora de ±5 min é recusado (replay). Comparação em tempo constante.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCIA_SEGUNDOS = 5 * 60;

export type ResultadoAssinatura =
  { ok: true } | { ok: false; motivo: "sem_segredo" | "ausente" | "expirada" | "invalida" };

export function assinar(segredo: string, timestamp: string, corpo: string): string {
  return `sha256=${createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex")}`;
}

export function conferirAssinatura(p: {
  segredo: string;
  timestamp: string | null;
  assinatura: string | null;
  corpo: string;
  agoraMs?: number;
}): ResultadoAssinatura {
  if (!p.segredo) return { ok: false, motivo: "sem_segredo" };
  if (!p.timestamp || !p.assinatura) return { ok: false, motivo: "ausente" };
  if (!/^\d{1,12}$/.test(p.timestamp)) return { ok: false, motivo: "invalida" };
  const agora = Math.floor((p.agoraMs ?? Date.now()) / 1000);
  if (Math.abs(agora - Number(p.timestamp)) > TOLERANCIA_SEGUNDOS)
    return { ok: false, motivo: "expirada" };

  const esperada = Buffer.from(assinar(p.segredo, p.timestamp, p.corpo));
  const recebida = Buffer.from(p.assinatura.trim().toLowerCase());
  if (esperada.length !== recebida.length) return { ok: false, motivo: "invalida" };
  return timingSafeEqual(esperada, recebida) ? { ok: true } : { ok: false, motivo: "invalida" };
}
