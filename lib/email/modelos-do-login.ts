/**
 * Os e-mails do LOGIN (Supabase Auth / GoTrue) na mesma casca dos e-mails do
 * CRM — com logo, cor e rodapé da marca.
 *
 * Quem envia é o GoTrue, não o app: ele baixa o HTML de
 * `GOTRUE_MAILER_TEMPLATES_<TIPO>` (uma URL) e o renderiza como template Go.
 * Por isso este módulo devolve HTML com as variáveis do GoTrue CRUAS
 * (`{{ .RedirectTo }}`, `{{ .TokenHash }}`, `{{ .Token }}`) — quem as preenche
 * é ele, na hora do envio. A rota `app/email/modelos/[tipo]/route.ts` serve o
 * resultado.
 *
 * ── O LINK: `{{ .RedirectTo }}&token_hash=…`, nunca `?` ───────────────────────
 *
 * `.RedirectTo` já chega com `?type=signup` / `?type=recovery` aberto pelo
 * Server Action (`signUp.ts`, `requestPasswordReset.ts`). Um segundo `?`
 * engoliria o `token_hash` dentro do valor de `type` e `/auth/confirm`
 * mandaria a pessoa para "link inválido" com um token válido na mão — o
 * defeito que `tests/unit/link-de-email-tem-uma-query-so.test.ts` guarda.
 *
 * Os tipos que o app NÃO dispara hoje (convite, link mágico, troca de e-mail)
 * usam `{{ .ConfirmationURL }}`, o link padrão do GoTrue: nenhum Server Action
 * abre query para eles, e o formato `&token_hash` quebraria.
 */
import type { MarcaDeSaida } from "@/lib/branding/saida";

import { escapeHtml, layoutDeEmail, paragrafo } from "./layout";

export const TIPOS_DO_LOGIN = [
  "confirmation",
  "recovery",
  "invite",
  "magic_link",
  "email_change",
  "reauthentication",
] as const;

export type TipoDoLogin = (typeof TIPOS_DO_LOGIN)[number];

export function ehTipoDoLogin(valor: string): valor is TipoDoLogin {
  return (TIPOS_DO_LOGIN as readonly string[]).includes(valor);
}

/** O link que volta para `/auth/confirm` com o token — ver o cabeçalho. */
export const LINK_COM_TOKEN = "{{ .RedirectTo }}&token_hash={{ .TokenHash }}";
const LINK_PADRAO_DO_GOTRUE = "{{ .ConfirmationURL }}";

/** Assunto de cada e-mail — vai em `GOTRUE_MAILER_SUBJECTS_<TIPO>`. */
export function assuntoDoLogin(tipo: TipoDoLogin, nomeDaMarca: string): string {
  switch (tipo) {
    case "confirmation":
      return `Confirme seu e-mail — ${nomeDaMarca}`;
    case "recovery":
      return `Redefinir sua senha — ${nomeDaMarca}`;
    case "invite":
      return `Você foi convidado para o ${nomeDaMarca}`;
    case "magic_link":
      return `Seu link de acesso — ${nomeDaMarca}`;
    case "email_change":
      return `Confirme seu novo e-mail — ${nomeDaMarca}`;
    case "reauthentication":
      return `Seu código de verificação — ${nomeDaMarca}`;
  }
}

export function modeloDoLogin(
  tipo: TipoDoLogin,
  marca: MarcaDeSaida,
  baseDoApp?: string | null,
): string {
  const nome = escapeHtml(marca.nome);
  const comum = { marca, escaparUrlDoBotao: false as const, baseDoApp };

  switch (tipo) {
    case "confirmation":
      return layoutDeEmail({
        ...comum,
        previa: `Confirme seu e-mail para ativar sua conta no ${marca.nome}.`,
        titulo: "Falta só confirmar seu e-mail",
        corpoHtml:
          paragrafo("Olá!") +
          paragrafo(
            `Recebemos seu cadastro no <strong>${nome}</strong>. Para ativar a conta, confirme que este e-mail é seu — em seguida você entra direto no sistema, com tudo pronto para começar.`,
          ),
        botao: { texto: "Confirmar e entrar", url: LINK_COM_TOKEN },
        observacaoHtml:
          "O link funciona uma única vez e expira em 24 horas. Se você não criou esta conta, ignore este e-mail — nada será ativado.",
        motivo: `Você recebeu este e-mail porque este endereço foi usado para criar uma conta no ${marca.nome}.`,
      });
    case "recovery":
      return layoutDeEmail({
        ...comum,
        previa: `Crie uma nova senha para sua conta no ${marca.nome}.`,
        titulo: "Redefinir sua senha",
        corpoHtml:
          paragrafo("Olá!") +
          paragrafo(
            `Recebemos um pedido para redefinir a senha da sua conta no <strong>${nome}</strong>. Clique no botão abaixo para escolher uma nova senha.`,
          ),
        botao: { texto: "Criar nova senha", url: LINK_COM_TOKEN },
        observacaoHtml:
          "O link funciona uma única vez e expira em breve. Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo.",
        motivo: `Você recebeu este e-mail porque alguém pediu para redefinir a senha desta conta no ${marca.nome}.`,
      });
    case "invite":
      return layoutDeEmail({
        ...comum,
        previa: `Você foi convidado para o ${marca.nome}.`,
        titulo: "Você foi convidado",
        corpoHtml: paragrafo(
          `Você recebeu um convite para acessar o <strong>${nome}</strong>. Clique no botão abaixo para aceitar e criar seu acesso.`,
        ),
        botao: { texto: "Aceitar convite", url: LINK_PADRAO_DO_GOTRUE },
        observacaoHtml: "Se você não esperava este convite, pode ignorar este e-mail.",
        motivo: `Você recebeu este e-mail porque este endereço foi convidado para o ${marca.nome}.`,
      });
    case "magic_link":
      return layoutDeEmail({
        ...comum,
        previa: `Seu link de acesso ao ${marca.nome}.`,
        titulo: "Seu link de acesso",
        corpoHtml: paragrafo(
          `Clique no botão abaixo para entrar no <strong>${nome}</strong> sem digitar senha.`,
        ),
        botao: { texto: "Entrar agora", url: LINK_PADRAO_DO_GOTRUE },
        observacaoHtml:
          "O link funciona uma única vez e expira em breve. Se não foi você que pediu, ignore este e-mail.",
        motivo: `Você recebeu este e-mail porque alguém pediu um link de acesso para esta conta no ${marca.nome}.`,
      });
    case "email_change":
      return layoutDeEmail({
        ...comum,
        previa: `Confirme o novo endereço de e-mail da sua conta no ${marca.nome}.`,
        titulo: "Confirme seu novo e-mail",
        corpoHtml: paragrafo(
          `Recebemos um pedido para trocar o e-mail da sua conta no <strong>${nome}</strong> para <strong>{{ .NewEmail }}</strong>. Confirme para concluir a troca.`,
        ),
        botao: { texto: "Confirmar novo e-mail", url: LINK_PADRAO_DO_GOTRUE },
        observacaoHtml: "Se você não pediu esta troca, ignore este e-mail — nada será alterado.",
        motivo: `Você recebeu este e-mail porque este endereço foi informado como novo e-mail de uma conta no ${marca.nome}.`,
      });
    case "reauthentication":
      return layoutDeEmail({
        ...comum,
        previa: `Seu código de verificação no ${marca.nome}.`,
        titulo: "Seu código de verificação",
        corpoHtml:
          paragrafo(`Use o código abaixo para confirmar a operação no <strong>${nome}</strong>:`) +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr><td align="center" style="background:#f4f5f4;border:1px dashed ${marca.accent};border-radius:12px;padding:18px 12px;font-size:32px;font-weight:800;letter-spacing:0.3em;font-family:ui-monospace,Menlo,Consolas,monospace">{{ .Token }}</td></tr></table>`,
        observacaoHtml: "O código expira em breve. Se não foi você, ignore este e-mail.",
        motivo: `Você recebeu este e-mail porque uma operação na sua conta do ${marca.nome} pediu confirmação.`,
      });
  }
}
