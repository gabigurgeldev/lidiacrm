/**
 * A forma de uma tag antes de ir para um `tags text[]` ou para o catálogo
 * (`crm_tags`, migration 0248).
 *
 * Só apara e deduplica — NÃO muda a caixa. Os arrays são comparados por texto
 * EXATO em fluxos, follow-up, disparo e automações (`regra-de-marcador.ts`);
 * baixar a caixa aqui faria uma regra configurada com "VIP" parar de casar com
 * o contato que acabou de ganhar a tag. Quem decide a grafia é o catálogo.
 */

export const TAMANHO_MAXIMO_DA_TAG = 40;

export function normalizarTag(bruta: string): string {
  return bruta.replace(/\s+/g, " ").trim();
}

/** Apara, descarta vazias e deduplica preservando a primeira ocorrência. */
export function normalizarTags(brutas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const b of brutas) {
    const t = normalizarTag(b);
    if (!t || vistas.has(t)) continue;
    vistas.add(t);
    saida.push(t);
  }
  return saida;
}

/** O nome que a tela de Tags aceita criar: 1..40 caracteres depois de aparar. */
export function nomeDeTagValido(nome: string): boolean {
  const t = normalizarTag(nome);
  return t.length >= 1 && t.length <= TAMANHO_MAXIMO_DA_TAG;
}

/** Cores oferecidas na tela — as mesmas de `fn_cor_da_tag` (migration 0248). */
export const PALETA_DE_TAGS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#64748b",
] as const;
