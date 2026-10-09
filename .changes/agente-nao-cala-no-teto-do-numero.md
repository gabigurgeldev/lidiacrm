---
impacto: nada_mudou
secao: corrigido
titulo: Número conectado há meses deixa de ser tratado como novo, e o follow-up no limite do dia é adiado em vez de sumir
---

Todo número de WhatsApp passa por um aquecimento contra banimento: nos
primeiros dias ele pode mandar poucas mensagens por dia (20, depois 50, 100,
200), e a partir de um mês não há mais limite. A idade do número só era
conhecida se alguém tivesse salvo a tela **Conexões › Proteção de envio**. Sem
isso, todo número era tratado como recém-nascido para sempre — limite de 20
mensagens por dia, mesmo num número de meses.

Responder a quem escreveu nas últimas 24 horas já não consome esse limite. Mas
as mensagens que o agente manda por conta própria (follow-up) consomem, e
quando o limite acabava, o follow-up simplesmente não saía: aparecia como
concluído, sem aviso, e não era tentado de novo.

Agora:

- **A idade conta desde que o número foi conectado ao CRM**, quando ninguém
  informou outra data. Um número conectado há mais de um mês não tem mais o
  limite de aquecimento. A tela de Proteção de envio diz de onde a idade veio
  e convida a informar a data real, se o número já era usado antes.
- **Salvar a tela de Proteção de envio não "rejuvenesce" mais o número.** Antes,
  mudar só a janela de horário fazia o número voltar a ter idade zero.
- **Limite atingido adia a mensagem em vez de perdê-la.** Ela sai na próxima
  abertura da janela de envio, e a **Central de avisos** mostra o mesmo aviso de
  limite do número que já aparecia quando o envio era barrado.
- Automações e disparos em massa passam a usar a mesma idade que o agente.

Nada muda para quem opera o servidor: não há mudança de banco nem passo manual.
