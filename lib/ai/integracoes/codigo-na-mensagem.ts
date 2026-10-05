/**
 * O código de verificação dentro da mensagem do cliente.
 *
 * Exatamente UM bloco de 6 dígitos (com espaço, ponto ou hífen no meio,
 * como "482 913" ou "482-913"). Dois blocos, ou nenhum, devolve null: o
 * runtime não adivinha qual dos números o cliente quis mandar — e um telefone
 * ou CEP na mesma frase não pode ser consumido como tentativa.
 */
export function extrairCodigo(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const candidatos = texto.match(/(?<!\d)\d{3}[\s.-]?\d{3}(?!\d)/g) ?? [];
  // Descarta números maiores grudados por separador (ex.: telefone "11 98765-4321").
  const limpos = candidatos.map((c) => c.replace(/[\s.-]/g, "")).filter((c) => c.length === 6);
  const unicos = [...new Set(limpos)];
  if (unicos.length !== 1) return null;
  // A mensagem não pode ter outros dígitos soltos além do código (CEP, telefone).
  const outrosDigitos = texto.replace(candidatos[0] ?? "", "").replace(/\D/g, "");
  if (outrosDigitos.length > 0) return null;
  return unicos[0] ?? null;
}
