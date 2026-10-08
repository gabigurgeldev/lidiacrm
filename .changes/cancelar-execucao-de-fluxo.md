---
impacto: capacidade_nova
secao: adicionado
titulo: Botão para cancelar uma execução de fluxo em andamento
---

Na tela de execuções de um fluxo, cada execução que ainda está rodando ou
esperando o cliente ganhou o botão **Cancelar execução**, com confirmação.

O fluxo para onde está e não continua: os blocos seguintes não rodam, e a
próxima mensagem do cliente não o acorda mais. Se o fluxo estava calando o
agente de IA ("A IA fica calada enquanto o fluxo conversa"), o agente volta a
responder na próxima mensagem. A trilha da execução registra que ela foi
cancelada por uma pessoa.

Antes, uma triagem iniciada por engano só terminava quando o cliente
respondesse todas as perguntas ou quando o prazo vencesse.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
