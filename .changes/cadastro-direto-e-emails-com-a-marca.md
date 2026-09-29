---
impacto: exige_acao
secao: alterado
titulo: Cadastro de uma tela só, direto para o CRM, e todos os e-mails com a marca
---

O cadastro público pede nome, empresa, WhatsApp, e-mail, senha e aceite dos
termos de uma vez. Ao confirmar o e-mail, a organização já nasce pronta e a
pessoa entra direto no CRM — o assistente de boas-vindas não aparece mais para
quem se cadastra (continua para a organização criada pelo instalador ou pelo
painel da plataforma). A tela depois do cadastro foi redesenhada: diz o
remetente, manda olhar Spam e Promoções e permite reenviar o e-mail.

Com a confirmação de e-mail desligada no Auth, a conta agora nasce certa e
entra no CRM na hora — antes a organização nunca era criada.

Todos os e-mails (confirmação, redefinir senha, convites, LGPD) saem numa casca
única com o logo e a cor da marca. Os e-mails do CRM podem sair por SMTP
(Amazon SES ou outro), além do Resend.

## Requer atenção

- **E-mails do login com a marca:** no Auth do Supabase (GoTrue), aponte
  `GOTRUE_MAILER_TEMPLATES_<TIPO>` para `https://<seu-domínio>/email/modelos/<tipo>`
  (tipos: `confirmation`, `recovery`, `invite`, `magic_link`, `email_change`,
  `reauthentication`) e `GOTRUE_MAILER_SUBJECTS_<TIPO>` para o assunto
  (`https://<seu-domínio>/email/modelos/<tipo>?assunto=1` mostra o sugerido).
  Sem isso o Supabase segue mandando o texto padrão dele.
- **E-mails do CRM por SMTP (opcional):** preencha `EMAIL_SMTP_HOST`,
  `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS` e `EMAIL_FROM` no
  `.env` do app. Vazio mantém o comportamento atual (Resend, ou e-mail
  desligado).
