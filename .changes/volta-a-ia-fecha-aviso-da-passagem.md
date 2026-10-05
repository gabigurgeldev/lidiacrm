---
impacto: nada_mudou
secao: corrigido
titulo: Devolver a conversa à IA passou a fechar o aviso da passagem — e a próxima passagem volta a avisar o dono
---

Quando a IA passa uma conversa para a equipe, ela abre um aviso na Central e
dispara o gatilho de fluxo "Quando a IA passar para uma pessoa" — que é o que
manda o aviso no WhatsApp do dono.

Esse aviso só nasce se não houver outro **aberto** para o mesmo cliente, para
não avisar duas vezes a mesma passagem. Só que devolver a conversa à IA — pelo
botão "Devolver ao automático" ou pelo bloco de fluxo "Entregar a conversa para
a IA" — não fechava o aviso. Ele ficava aberto para sempre, a menos que alguém
clicasse em "Marcar resolvido" na Central.

O efeito: o cliente voltava para a IA, pedia ajuda de novo dias depois, a IA
passava a conversa para a equipe… e ninguém era avisado. Nenhum aviso novo na
Central, nenhum gatilho, nenhuma mensagem no WhatsApp. Num fluxo que devolve a
conversa à IA sozinho depois de um tempo, isso acontecia a partir da segunda
passagem de todo cliente.

Agora, devolver a conversa à IA fecha o aviso de passagem daquele cliente. A
próxima passagem abre um aviso novo e dispara o fluxo de novo.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
