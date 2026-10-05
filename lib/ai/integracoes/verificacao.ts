/**
 * VERIFICAÇÃO DE IDENTIDADE — o código por e-mail (as partes puras).
 *
 * O cliente diz no WhatsApp qual é o e-mail da conta; o CRM pergunta a cada
 * sistema "este e-mail tem conta?"; se tiver, manda um código de 6 dígitos
 * para ESSE e-mail; o cliente digita o código na conversa; o runtime confere
 * antes do modelo rodar. Só então a conversa ganha acesso — àquela conta, por
 * `sessao_horas`.
 *
 * O que fica guardado e o que nunca fica:
 *
 *   - o código: só o HMAC com chave derivada (`derivarChave`), nunca em claro.
 *     Não aparece em log, em resultado de ferramenta, nem no prompt;
 *   - o e-mail: hash com chave (para os limites por e-mail), máscara (para o
 *     prompt e a tela) e cifrado (para o cabeçalho do contrato de suporte, que
 *     o sistema externo usa para conferir de novo a posse da conta).
 *
 * ANTI-ENUMERAÇÃO: a resposta ao cliente é a MESMA exista a conta ou não. Quem
 * testa e-mails alheios na conversa não aprende quais têm conta.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { derivarChave } from "@/lib/crypto/aes_gcm";

export const VALIDADE_DO_CODIGO_MS = 10 * 60 * 1000;
export const TENTATIVAS_MAXIMAS = 5;

/** Limites contados no BANCO (o worker roda sem Redis garantido). */
export const LIMITES = {
  porConversaPorHora: 3,
  porEmailPorDia: 5,
  porOrganizacaoPorHora: 100,
} as const;

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function emailValido(email: string): boolean {
  const e = normalizarEmail(email);
  return e.length <= 254 && EMAIL_RX.test(e);
}

/** "ana.souza@gmail.com" → "a***a@g***l.com" */
export function mascararEmail(email: string): string {
  const e = normalizarEmail(email);
  const [usuario = "", dominio = ""] = e.split("@");
  const ponto = dominio.lastIndexOf(".");
  const nomeDom = ponto > 0 ? dominio.slice(0, ponto) : dominio;
  const tld = ponto > 0 ? dominio.slice(ponto) : "";
  const m = (s: string) => (s.length <= 2 ? `${s[0] ?? ""}***` : `${s[0]}***${s[s.length - 1]}`);
  return `${m(usuario)}@${m(nomeDom)}${tld}`;
}

export function hashDoEmail(organizationId: string, email: string): string {
  return createHmac("sha256", derivarChave("ai-api-email"))
    .update(`${organizationId}:${normalizarEmail(email)}`)
    .digest("hex");
}

export function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashDoCodigo(verificacaoId: string, codigo: string): string {
  return createHmac("sha256", derivarChave("ai-api-otp")).update(`${verificacaoId}:${codigo}`).digest("hex");
}

export function codigoConfere(verificacaoId: string, codigo: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashDoCodigo(verificacaoId, codigo), "hex");
  const b = Buffer.from(hashGuardado, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ContagensRecentes = {
  conversaUltimaHora: number;
  emailUltimoDia: number;
  organizacaoUltimaHora: number;
};

export type MotivoDeRecusa = "limite_conversa" | "limite_email" | "limite_organizacao";

export function podeEmitirDesafio(c: ContagensRecentes): { ok: true } | { ok: false; motivo: MotivoDeRecusa } {
  if (c.conversaUltimaHora >= LIMITES.porConversaPorHora) return { ok: false, motivo: "limite_conversa" };
  if (c.emailUltimoDia >= LIMITES.porEmailPorDia) return { ok: false, motivo: "limite_email" };
  if (c.organizacaoUltimaHora >= LIMITES.porOrganizacaoPorHora) return { ok: false, motivo: "limite_organizacao" };
  return { ok: true };
}

/**
 * A frase que o agente recebe depois de pedir a verificação — IGUAL com ou
 * sem conta (anti-enumeração). O código nunca está aqui.
 */
export function respostaDoPedidoDeCodigo(emailMascarado: string): string {
  return (
    `Se ${emailMascarado} tiver conta nos sistemas, um código de 6 dígitos foi enviado para esse e-mail ` +
    `e vale 10 minutos. Peça ao cliente para digitar o código AQUI na conversa. ` +
    `Não peça o e-mail de novo e não repita o código: a conferência é automática.`
  );
}
