import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Só os dígitos do telefone; `55` na frente quando veio sem DDI. */
export function normalizarWhatsapp(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

/**
 * Cadastro de quem ABRE a empresa. Pede, de uma vez, tudo o que o assistente
 * de 7 passos pedia de indispensável — quem é a pessoa, a empresa, um contato e
 * o aceite dos termos —, e a organização nasce pronta no clique do link de
 * confirmação (`lib/auth/provision.ts`), sem assistente.
 */
export const signupSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, "Informe seu nome")
      .max(120, "Nome deve ter no máximo 120 caracteres"),
    org_name: z
      .string()
      .trim()
      .min(2, "Nome da empresa deve ter pelo menos 2 caracteres")
      .max(120, "Nome da empresa deve ter no máximo 120 caracteres"),
    whatsapp: z
      .string()
      .refine((v) => /^\d{12,13}$/.test(normalizarWhatsapp(v)), "Informe o WhatsApp com DDD"),
    email: z.string().email("Email inválido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    password_confirm: z.string(),
    aceite_termos: z.boolean().refine((v) => v === true, "Aceite os termos para continuar"),
    // Código do afiliado que indicou (link do Back Office). Opcional; quem diz
    // se ele vale é o servidor, perguntando ao Back Office.
    codigo_indicacao: z
      .string()
      .trim()
      .max(20, "Código de indicação inválido")
      .refine((v) => v === "" || /^[A-Za-z0-9]{3,20}$/.test(v), "Código de indicação inválido")
      .optional(),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ["password_confirm"],
    message: "As senhas não coincidem",
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Signup de quem foi CONVIDADO: a empresa já existe, então pedir o nome dela
 * seria pedir para a pessoa batizar a organização de outra gente.
 *
 * É um schema à parte, e não `org_name` opcional no de cima, de propósito: o
 * caminho normal continua exigindo o nome, com a mesma mensagem, e nada no
 * fluxo de quem abre a própria empresa afrouxa por causa deste.
 */
export const signupComConviteSchema = z
  .object({
    email: z.string().email("Email inválido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    password_confirm: z.string(),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ["password_confirm"],
    message: "As senhas não coincidem",
  });

export type SignupComConviteInput = z.infer<typeof signupComConviteSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    password_confirm: z.string(),
    // Código TOTP: só exigido quando a conta tem MFA (a sessão de recovery é
    // AAL1 e o GoTrue pede AAL2 para trocar a senha). Opcional no schema; a
    // action decide se é obrigatório.
    mfa_code: z.string().optional(),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ["password_confirm"],
    message: "As senhas não coincidem",
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
