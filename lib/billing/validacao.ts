/**
 * Validação dos dados do checkout — a MESMA na tela e na rota.
 *
 * Tudo aqui é puro e não importa nada de servidor: a tela de pagamento usa
 * estas funções para acusar o erro no campo antes de mandar, e a rota as usa
 * de novo porque o que vem do navegador não é confiável.
 */
import { z } from "zod";

export const soDigitos = (s: string) => s.replace(/\D/g, "");

export function cpfValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (fatia: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < fatia.length; i++) soma += Number(fatia[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

export function cnpjValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (fatia: string) => {
    const pesos = fatia.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(fatia[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

export const documentoValido = (v: string) => cpfValido(v) || cnpjValido(v);

/** Luhn — pega número de cartão digitado errado antes de gastar uma tentativa no Asaas. */
export function luhnValido(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

export type Bandeira = "visa" | "mastercard" | "amex" | "elo" | "hipercard" | "diners" | "outra";

export function bandeiraDoNumero(numero: string): Bandeira {
  const d = soDigitos(numero);
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return "elo";
  if (/^(606282|3841)/.test(d)) return "hipercard";
  if (/^3[47]/.test(d)) return "amex";
  if (/^3(0[0-5]|[68])/.test(d)) return "diners";
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "mastercard";
  return "outra";
}

export const titularSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo").max(120),
  cpfCnpj: z.string().refine(documentoValido, "CPF ou CNPJ inválido"),
  email: z.string().trim().email("E-mail inválido").max(200),
  telefone: z.string().refine((v) => [10, 11].includes(soDigitos(v).length), "Telefone com DDD"),
  cep: z.string().refine((v) => soDigitos(v).length === 8, "CEP inválido"),
  numero: z.string().trim().min(1, "Informe o número").max(20),
});

export const cartaoSchema = z
  .object({
    numero: z.string().refine(luhnValido, "Número do cartão inválido"),
    nome: z.string().trim().min(3, "Nome como está no cartão").max(80),
    mes: z.string().refine((v) => {
      const n = Number(soDigitos(v));
      return n >= 1 && n <= 12;
    }, "Mês inválido"),
    ano: z.string().refine((v) => [2, 4].includes(soDigitos(v).length), "Ano inválido"),
    cvv: z.string().refine((v) => [3, 4].includes(soDigitos(v).length), "CVV inválido"),
  })
  .refine(
    (c) => {
      const ano = soDigitos(c.ano).length === 2 ? 2000 + Number(soDigitos(c.ano)) : Number(soDigitos(c.ano));
      const mes = Number(soDigitos(c.mes));
      const agora = new Date();
      return ano > agora.getFullYear() || (ano === agora.getFullYear() && mes >= agora.getMonth() + 1);
    },
    { message: "Cartão vencido", path: ["ano"] },
  );

export const checkoutSchema = z
  .object({
    metodo: z.enum(["PIX", "CREDIT_CARD"]),
    titular: titularSchema,
    cartao: cartaoSchema.optional(),
  })
  .refine((v) => v.metodo !== "CREDIT_CARD" || !!v.cartao, {
    message: "Informe os dados do cartão",
    path: ["cartao"],
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;
