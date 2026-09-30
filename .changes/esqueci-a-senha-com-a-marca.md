---
impacto: nada_mudou
secao: corrigido
titulo: "Esqueci a senha" chega com o visual da marca
---

O e-mail de redefinição de senha passa a ser enviado pelo próprio CRM, pelo
mesmo provedor dos convites (Amazon SES, SMTP ou Resend), com o logo e o visual
novo. Antes ele saía pelo Supabase com o texto padrão dele, porque nas
instalações do EasyPanel o serviço de login não recebe os modelos da marca. Sem
e-mail configurado no CRM, continua saindo pelo Supabase como antes.
