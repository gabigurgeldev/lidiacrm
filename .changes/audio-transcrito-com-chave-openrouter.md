---
impacto: capacidade_nova
secao: corrigido
titulo: O agente entende áudio com a chave da OpenRouter
---

A transcrição de áudio só funcionava com uma chave da OpenAI. Quem instalou
usando só a OpenRouter, que é a primeira opção do instalador, ficava com o
agente respondendo a todo áudio de cliente com "não consegui abrir o arquivo".
A chave existia e servia, mas o código não a usava.

Agora, sem chave da OpenAI, a transcrição usa a da OpenRouter, pelo modelo
`openai/gpt-4o-mini-transcribe`, que custa cerca de US$ 0,0015 por minuto de
áudio. Com chave da OpenAI cadastrada nada muda: ela continua sendo usada
primeiro, com o mesmo modelo de antes.

A tela **Agente de IA › Provedores** também mostrava errado. No ponto "Ouvir o
áudio do cliente" ela anunciava o modelo de conversa da organização (por
exemplo, `claude-sonnet-5`), que nunca transcreve nada. Agora ela mostra o
modelo que de fato transcreve e qual chave está sendo usada. Sem nenhuma das
duas chaves, aparece um aviso.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
