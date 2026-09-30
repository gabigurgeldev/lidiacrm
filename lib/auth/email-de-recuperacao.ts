/**
 * O E-MAIL DE "ESQUECI A SENHA" SAI PELO CRM, COM A MARCA.
 *
 * Quem mandava era o GoTrue (Supabase Auth), com o template que ELE conhece. Para
 * ele usar o nosso (`/email/modelos/recovery`) é preciso `GOTRUE_MAILER_TEMPLATES_*`
 * no contêiner do Auth — e no Supabase do EasyPanel o compose é fixo (repositório
 * `easypanel-io/compose`, sem `env_file`): essas variáveis nunca chegam lá. Medido
 * em produção (2026-09-30): SMTP do Auth configurado, nenhum template — o e-mail
 * saía com o texto cru do Supabase.
 *
 * Aqui o CRM pede ao Auth só o LINK (`admin.generateLink`, que não envia nada) e
 * manda o e-mail ele mesmo, pelo mesmo SMTP/SES dos convites, na casca da marca.
 * Não depende de configurar nada no Auth, em nenhuma instalação.
 *
 * O link é o de sempre: `/auth/confirm?type=recovery&token_hash=…`, que
 * `app/auth/confirm/route.ts` já troca por sessão com `verifyOtp`.
 */
import { marcaDaSaida } from "@/lib/branding/saida";
import { escapeHtml } from "@/lib/email/layout";
import { assuntoDoLogin, LINK_COM_TOKEN, modeloDoLogin } from "@/lib/email/modelos-do-login";
import { sendEmail } from "@/lib/email/resend";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export type DesfechoDaRecuperacao = "enviado" | "sem_conta" | "falhou";

/** Troca o marcador do GoTrue pelo link real, já escapado para atributo HTML. */
export function comLinkReal(html: string, link: string): string {
  return html.split(LINK_COM_TOKEN).join(escapeHtml(link));
}

export async function enviarRecuperacaoPeloApp(
  email: string,
  redirectTo: string,
): Promise<DesfechoDaRecuperacao> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (error) {
    // E-mail sem conta: resposta neutra, como o GoTrue faz — dizer "não existe"
    // transformaria a tela num oráculo de quem é cliente.
    const msg = error.message.toLowerCase();
    if (error.status === 404 || msg.includes("not found")) return "sem_conta";
    logger.warn("recuperacao: generateLink falhou", { status: error.status, erro: error.message });
    return "falhou";
  }

  const hash = data.properties?.hashed_token;
  if (!hash) return "falhou";

  const separador = redirectTo.includes("?") ? "&" : "?";
  const link = `${redirectTo}${separador}token_hash=${encodeURIComponent(hash)}`;
  const marca = await marcaDaSaida(null);
  const html = comLinkReal(modeloDoLogin("recovery", marca), link);

  const r = await sendEmail({
    to: email,
    subject: assuntoDoLogin("recovery", marca.nome),
    html,
    text: `Recebemos um pedido para redefinir sua senha no ${marca.nome}.\n\nCrie uma nova senha: ${link}\n\nSe não foi você, ignore este e-mail — sua senha atual continua valendo.`,
    fromName: marca.nome,
  });
  if (!r.ok) {
    logger.warn("recuperacao: envio pelo app falhou", { erro: r.error });
    return "falhou";
  }
  return "enviado";
}
