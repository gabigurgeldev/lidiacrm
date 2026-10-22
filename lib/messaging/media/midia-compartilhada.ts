/**
 * MÍDIA COMPARTILHADA — um arquivo que vale para muitas mensagens.
 *
 * Duas origens hoje, e as duas existem pelo mesmo motivo: o arquivo é da
 * ORGANIZAÇÃO, não de uma conversa, então não pode morar em
 * `{org}/{conversa}/` (o redact da LGPD de um contato o apagaria para todos)
 * nem ir em `messages.media_storage_path` (que é o que o redact coleta).
 *
 *  - `disparo`: a mídia do disparo em massa, `{org}/disparos/…`.
 *  - `material`: uma foto do acervo que o agente envia, `{org}/materiais/…`.
 *
 * Cada origem grava o caminho numa chave própria de `messages.metadata`, que é
 * de onde a tela o assina para mostrar a bolha. Quem lê usa
 * `midiaCompartilhadaDaMensagem` e não a chave crua, para que uma terceira
 * origem não exija caçar leitores pelo repositório.
 */

export const ORIGENS_DE_MIDIA_COMPARTILHADA = {
  disparo: { pasta: "disparos", chave: "midia_do_disparo" },
  material: { pasta: "materiais", chave: "midia_do_material" },
} as const;

export type OrigemDeMidiaCompartilhada = keyof typeof ORIGENS_DE_MIDIA_COMPARTILHADA;

/** As chaves de metadata que só o servidor pode escrever. */
export const CHAVES_DE_MIDIA_COMPARTILHADA: readonly string[] = Object.values(
  ORIGENS_DE_MIDIA_COMPARTILHADA,
).map((o) => o.chave);

export function prefixoDaOrigem(orgId: string, origem: OrigemDeMidiaCompartilhada): string {
  return `${orgId}/${ORIGENS_DE_MIDIA_COMPARTILHADA[origem].pasta}/`;
}

/** O caminho está na pasta da origem DESTA organização (e não sobe de pasta)? */
export function caminhoDaOrigemValido(
  path: string,
  orgId: string,
  origem: OrigemDeMidiaCompartilhada,
): boolean {
  return path.startsWith(prefixoDaOrigem(orgId, origem)) && !path.includes("..");
}

/**
 * O caminho da mídia compartilhada gravado numa mensagem, se houver e se for
 * desta organização. Devolve null para metadata sem a chave ou com caminho de
 * fora — a tela trata os dois como "sem mídia", nunca como erro.
 */
export function midiaCompartilhadaDaMensagem(
  metadata: unknown,
  orgId: string,
): { path: string; origem: OrigemDeMidiaCompartilhada } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  for (const origem of Object.keys(ORIGENS_DE_MIDIA_COMPARTILHADA) as OrigemDeMidiaCompartilhada[]) {
    const bruto = m[ORIGENS_DE_MIDIA_COMPARTILHADA[origem].chave];
    if (typeof bruto === "string" && caminhoDaOrigemValido(bruto, orgId, origem)) {
      return { path: bruto, origem };
    }
  }
  return null;
}

/** A mensagem TEM mídia compartilhada (sem conferir a org — uso de tela). */
export function temMidiaCompartilhada(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const m = metadata as Record<string, unknown>;
  return CHAVES_DE_MIDIA_COMPARTILHADA.some((k) => typeof m[k] === "string");
}
