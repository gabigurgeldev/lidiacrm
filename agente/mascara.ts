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
 * Rede de segurança para TEXTO LIVRE (título de agendamento, nome de etapa,
 * a própria pergunta de quem usa a assistente): qualquer sequência que pareça
 * telefone, CPF ou CNPJ é mascarada antes de ir ao modelo ou ao banco. 8+
 * dígitos, com ou sem pontuação no meio — celular e fixo sem DDD inclusive
 * ("98765-4321", "3456 7890").
 *
 * Data REAL ("03/11/2026", "2026-11-03") é protegida antes da varredura: ela
 * tem 8 dígitos e viraria "•••• 2026". Só conta como data o que tem dia e mês
 * válidos — "11/98765-4321" não é data e é mascarado.
 */
export function mascararNumerosLongos(texto: string): string {
  const datas: string[] = [];
  const protegido = texto.replace(DATA_NO_TEXTO, (d) => {
    datas.push(d);
    return `${MARCA}${String.fromCharCode(0xe100 + datas.length - 1)}${MARCA}`;
  });
  const mascarado = protegido.replace(NUMERO_LONGO, (trecho) => {
    const digitos = trecho.replace(/\D/g, "");
    return digitos.length >= 8 ? `•••• ${digitos.slice(-4)}` : trecho;
  });
  return mascarado.replace(MARCA_DE_DATA, (_, c: string) => datas[c.charCodeAt(0) - 0xe100] ?? "");
}

/** "joana.silva@gmail.com" → "j•••@gmail.com". O domínio ajuda a reconhecer; o resto não. */
export function mascararEmails(texto: string): string {
  return texto.replace(EMAIL, (_, inicio: string, dominio: string) => `${inicio}•••@${dominio}`);
}

/** E-mail e números longos — o que vai de texto livre ao modelo e ao histórico. */
export function mascararTextoLivre(texto: string): string {
  return mascararNumerosLongos(mascararEmails(texto));
}

const NUMERO_LONGO = /\+?\d[\d\s().\-/]{6,}\d/g;
const DIA = String.raw`(?:0?[1-9]|[12]\d|3[01])`;
const MES = String.raw`(?:0?[1-9]|1[0-2])`;
const DATA_NO_TEXTO = new RegExp(
  String.raw`(?<![\d/.\-])(?:${DIA}[/.\-]${MES}[/.\-](?:\d{4}|\d{2})|\d{4}-${MES}-${DIA})(?![\d/.\-])`,
  "g",
);
const MARCA = "\ue000";
const MARCA_DE_DATA = /\ue000([\ue100-\uefff])\ue000/g;
const EMAIL = /\b([a-z0-9])[a-z0-9._%+-]*@([a-z0-9.-]+\.[a-z]{2,})\b/gi;
