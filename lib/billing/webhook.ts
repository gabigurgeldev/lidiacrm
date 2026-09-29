import { timingSafeEqual } from "node:crypto";

/**
 * Confere o header `asaas-access-token` em tempo constante. Token vazio no
 * `.env` nunca confere — webhook sem token configurado recusa tudo.
 */
export function tokenConfere(recebido: string | null, esperado: string): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
