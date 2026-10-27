/**
 * Dinheiro na tela do Kanban — UM formatador só.
 *
 * Havia três cópias (`formatBRL` no card, no cabeçalho da coluna e no dossiê),
 * e a do cabeçalho forçava BRL mesmo em negócio de outra moeda. Valor em
 * centavos, moeda ISO-4217 (o contrato da API); sem casas decimais na vitrine.
 */
export function formatarReais(cents: number, moeda: string | null = "BRL"): string {
  const codigo = moeda || "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: codigo,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${codigo}`;
  }
}

/** Centavos → texto editável "1234,50" (o campo de valor do formulário). */
export function centavosParaCampo(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
