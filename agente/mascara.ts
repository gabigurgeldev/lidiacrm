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
 * ao modelo. 10+ dígitos sempre; 8–9 dígitos também (celular e fixo sem DDD:
 * "98765-4321", "3456 7890"), menos o que tem forma de data ("03/11/2026").
 */
export function mascararNumerosLongos(texto: string): string {
  return texto.replace(/(?:\+?\d[\d\s().\-/]{6,}\d)/g, (trecho) => {
    const digitos = trecho.replace(/\D/g, "");
    if (digitos.length >= 10) return `•••• ${digitos.slice(-4)}`;
    if (digitos.length >= 8 && !pareceData(trecho)) return `•••• ${digitos.slice(-4)}`;
    return trecho;
  });
}

const DATA = /^\s*\d{1,4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}\s*$/;

function pareceData(trecho: string): boolean {
  return trecho.includes("/") || DATA.test(trecho);
}
