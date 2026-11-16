---
impacto: nada_mudou
secao: corrigido
titulo: A saudação automática do WhatsApp Business não pausa mais o agente
---

Quando a loja responde pelo próprio celular, o agente sai da conversa: quem
responde à mão assumiu o atendimento. Só que a **saudação** e a
**mensagem de ausência** que se configuram no app do WhatsApp Business também
saem do celular, e o sistema as tomava por uma pessoa respondendo.

O efeito, medido numa instalação real: a saudação saía um segundo depois de
toda cliente nova e pausava a conversa antes de o agente falar. O agente passou
13 dias sem responder ninguém, e a passagem para a dona, com o aviso no
WhatsApp dela, nunca disparou.

Agora a mensagem do celular que chega até 15 segundos depois da cliente, com um
texto que a loja já mandou assim, rápido, em pelo menos 5 outras conversas (em
70% das vezes ou mais), é tratada como resposta automática. Ela continua no
histórico, mas não pausa o agente. A resposta pronta que a atendente manda à
mão continua pausando: ela também se repete, mas quase nunca sai em segundos.

Para aprender, o sistema precisa ver o texto se repetir. Por isso, depois de
atualizar, ou de a loja trocar o texto da saudação, as primeiras conversas
ainda pausam. Conversas que já estavam pausadas continuam pausadas: para
devolver uma ao agente, use o botão na tela ou mande `#ia` na conversa.

Nada a fazer para atualizar: sem migration, sem variável nova, sem arquivo para
editar.
