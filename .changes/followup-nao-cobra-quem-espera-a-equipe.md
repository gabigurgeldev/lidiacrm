---
impacto: nada_mudou
secao: corrigido
titulo: O agente parou de repetir "passei para o responsável" a cada hora
---

Quando o agente abria um caso para a equipe (cancelamento, por exemplo), o
cliente era avisado uma vez — e depois recebia **a mesma explicação de novo, a cada hora útil**, sem ter escrito nada. As mensagens ainda pediam desculpa pela
confusão das anteriores.

A causa: o agente agenda o próprio retorno, e a trava contra retornos empilhados
só enxerga o que ainda está pendente. Quando o retorno disparava, ele já não
estava mais pendente — então o agente agendava o próximo, e a cadeia se
alimentava sozinha durante todo o horário comercial.

Agora, enquanto a conversa tem um caso aguardando a equipe, o follow-up **não fala**. Quando o caso é respondido ou fechado, o follow-up volta a valer. Caso
que espera uma informação **do cliente** continua podendo ser cobrado, porque aí
a próxima fala é dele.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
