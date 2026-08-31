"use server";

/**
 * A CHAVE DA INTELIGÊNCIA, PEDIDA ONDE ELA FALTA.
 *
 * O passo 1 já MEDE se a instalação trouxe chave, e quando não trouxe escrevia
 * "Falta a chave da inteligência artificial" — um diagnóstico correto e um beco:
 * a pessoa lê que falta e não tem o que fazer com a informação. Ela teria de
 * descobrir sozinha que existe uma tela de credenciais, e onde.
 *
 * Aqui ela cola a chave no passo em que a chave passa a importar — o de treinar,
 * imediatamente antes de o funcionário ser criado com ela.
 *
 * ⚠️ O MIOLO NÃO MORA AQUI. Cifrar, gravar, auditar e validar é
 * `lib/ai/credenciais/guardar.ts`, o mesmo caminho que a rota REST usa: cada
 * item dessa lista tem consequência de segurança se as duas cópias divergirem.
 */
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { guardarCredencial } from "@/lib/ai/credenciais/guardar";
import { IDS_DE_PROVEDOR } from "@/lib/ai/pontos/provedores";
import type { Provider } from "@/lib/ai/provider-validators";
import { requireOnboardingCtx, OnboardingError } from "./_shared";

export type ResultadoDaChave = { ok: true; final: string } | { ok: false; erro: string };

export async function salvarChaveDaIa(formData: FormData): Promise<ResultadoDaChave> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, erro: "Sua sessão expirou. Entre de novo." };
    throw err;
  }

  // Guardar chave de provedor é ação de administrador, igual à rota REST. Quem
  // faz o onboarding é o dono, mas o papel é verificado e não presumido.
  if (ctx.role !== "admin") {
    return { ok: false, erro: "Só um administrador pode cadastrar a chave da inteligência artificial." };
  }

  const provider = String(formData.get("provider") ?? "");
  if (!(IDS_DE_PROVEDOR as readonly string[]).includes(provider)) {
    return { ok: false, erro: "Escolha qual inteligência artificial você contratou." };
  }

  const apiKey = String(formData.get("api_key") ?? "").trim();
  if (apiKey.length < 8) {
    return { ok: false, erro: "Essa chave parece incompleta. Cole a chave inteira, do começo ao fim." };
  }

  const r = await guardarCredencial({
    admin: createAdminClient(),
    orgId: ctx.orgId,
    userId: ctx.userId,
    provider: provider as Provider,
    // O nome existe para a pessoa reconhecer a chave depois, na tela de
    // credenciais — não é identificador.
    label: "Chave do onboarding",
    apiKey,
  });

  if (!r.ok) {
    if (r.motivo === "label_em_uso") {
      return {
        ok: false,
        erro: "Já existe uma chave cadastrada com esse nome. Veja em IA › Credenciais.",
      };
    }
    // Este é o pior lugar possível para um erro mudo: é o wizard, primeira
    // impressão de quem acabou de instalar. "Tente de novo" é conselho falso
    // aqui — a falha é da configuração do servidor e repetir nunca resolve.
    if (r.motivo === "chave_de_cifragem_da_instalacao") {
      return {
        ok: false,
        erro:
          "Este servidor está com a chave de cifragem (AI_CRED_AES_KEY) inválida: ela precisa ter 32 bytes, em base64 ou hex. " +
          "Enquanto não for corrigida, nenhuma chave de IA pode ser guardada — avise quem administra a instalação.",
      };
    }
    return { ok: false, erro: "Não consegui guardar a chave agora. Tente de novo." };
  }

  // O passo lê o retrato da instalação no servidor; sem invalidar, ele seguiria
  // dizendo que falta a chave que acabou de ser cadastrada.
  revalidatePath("/onboarding", "layout");
  return { ok: true, final: r.last4 };
}
