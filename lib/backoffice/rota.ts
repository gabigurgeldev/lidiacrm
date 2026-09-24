/**
 * Casca comum das rotas `/backoffice/*`: confere a assinatura HMAC antes de
 * qualquer leitura e responde no formato do contrato do Back Office (JSON cru,
 * sem o envelope `{ data }` da API `/api/v1`: quem consome é o Back Office, e
 * o contrato é dele).
 */
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirAssinatura } from "./assinatura";
import type { Resposta } from "./tenants";

export function json(r: Resposta): Response {
  return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}

export async function rotaDoBackoffice(
  req: Request,
  handler: (ctx: { admin: SupabaseClient; corpo: string }) => Promise<Resposta>,
): Promise<Response> {
  const corpo = await req.text();
  const check = conferirAssinatura({
    segredo: env.BACKOFFICE_OUTBOUND_SECRET,
    timestamp: req.headers.get("x-timestamp"),
    assinatura: req.headers.get("x-backoffice-signature"),
    corpo,
  });
  if (!check.ok) {
    return check.motivo === "sem_segredo"
      ? json({ status: 503, body: { error: "backoffice_not_configured" } })
      : json({ status: 401, body: { error: `signature_${check.motivo}` } });
  }
  return json(await handler({ admin: createAdminClient(), corpo }));
}

/** Corpo JSON validado; erro de validação é 422 (o Back Office não repete 4xx). */
export function lerJson<T>(
  corpo: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
) {
  let bruto: unknown;
  try {
    bruto = JSON.parse(corpo);
  } catch {
    return null;
  }
  const r = schema.safeParse(bruto);
  return r.success ? r.data : null;
}
