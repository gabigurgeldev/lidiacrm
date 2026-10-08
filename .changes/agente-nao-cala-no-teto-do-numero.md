---
impacto: nada_mudou
secao: corrigido
titulo: O agente não para mais de responder depois da 20ª mensagem do dia
---

Todo número de WhatsApp passa por um aquecimento contra banimento: nos
primeiros dias ele pode mandar poucas mensagens por dia (20, depois 50, 100,
200), e a partir de um mês não há mais limite. A idade do número só era
conhecida se alguém tivesse salvo a tela **Conexões › Proteção de envio**. Sem
isso, todo número era tratado como recém-nascido para sempre — limite de 20
mensagens por dia, mesmo num número de meses.

E quando o limite era atingido, o agente simplesmente não respondia: o
atendimento aparecia como concluído, nenhuma mensagem saía, ninguém era avisado
e o cliente ficava sem resposta, nem naquele dia nem no seguinte.

Agora:

- **A idade conta desde que o número foi conectado ao CRM**, quando ninguém
  informou outra data. Um número conectado há mais de um mês não tem mais o
  limite de aquecimento. A tela de Proteção de envio diz de onde a idade veio
  e convida a informar a data real, se o número já era usado antes.
- **Salvar a tela de Proteção de envio não "rejuvenesce" mais o número.** Antes,
  mudar só a janela de horário fazia o número voltar a ter idade zero.
- **Limite atingido adia a resposta em vez de calar.** A mensagem do cliente é
  respondida na próxima abertura da janela de envio, e a **Central de avisos**
  mostra "Um número chegou ao limite de mensagens de hoje", com o que fazer.
- Automações e disparos em massa passam a usar a mesma idade que o agente.

Nada muda para quem opera o servidor: a atualização aplica sozinha a mudança de
banco (um tipo novo de aviso na Central), sem passo manual.
