/**
 * Dado de TERCEIRO que a assistente pode citar, sem entregar inteiro.
 *
 * O cliente da empresa (contato) não é quem está conversando com a assistente.
 * O nome ajuda a pessoa a reconhecer de quem se fala; o telefone e o documento
 * completos não ajudam em nada numa resposta de ajuda — e uma resposta de
 * modelo é texto que pode ser copiado, logado e colado em qualquer lugar.
 */

/** "5511987654321" → "•••• 4321". Menos de 4 dígitos não sobra nada para mostrar. */
export function mascararTelefone(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.length < 4) return "••••";
  return `•••• ${digitos.slice(-4)}`;
}

/** CPF/CNPJ: só os 2 últimos dígitos. */
export function mascararDocumento(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  return `•••••${digitos.slice(-2)}`;
}

/**
 * Rede de segurança para TEXTO LIVRE (título de agendamento, nome de etapa):
 * qualquer sequência que pareça telefone, CPF ou CNPJ é mascarada antes de ir
 * ao modelo. Pega 10+ dígitos, com ou sem pontuação no meio.
 */
export function mascararNumerosLongos(texto: string): string {
  return texto.replace(/(?:\+?\d[\d\s().\-/]{8,}\d)/g, (trecho) => {
    const digitos = trecho.replace(/\D/g, "");
    return digitos.length >= 10 ? `•••• ${digitos.slice(-4)}` : trecho;
  });
}
