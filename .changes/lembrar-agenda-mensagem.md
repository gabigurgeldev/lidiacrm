---
impacto: capacidade_nova
secao: adicionado
titulo: Agendar mensagem ao cliente pelo Lembrar da conversa
---

No menu da conversa, "Lembrar" ganhou "Agendar mensagem…": o atendente escolhe a
data e a hora, o texto e por qual número a mensagem sai, e o cliente a recebe no
horário marcado. Se o horário cair fora do horário de envio do número (7h às 22h
por padrão), a mensagem sai assim que ele abrir. O mesmo diálogo mostra o que já
está agendado naquela conversa e permite desmarcar.

Dá para pedir um aviso para si mesmo na mesma hora, pelo WhatsApp, num telefone
digitado ali (vem preenchido com o "Telefone de aviso" da tela de Equipe) e com
texto próprio. Quando a mensagem não sai — número desconectado, cliente que
bloqueou o atendimento, contato anonimizado —, a Central de avisos diz por quê.

Os lembretes de 1h, 3h e 24h continuam como estavam. A atualização cria uma
tabela nova (migration 0220), aplicada sozinha pelo `update.sh`, e o agendador
passa a chamar uma rota nova a cada minuto.
