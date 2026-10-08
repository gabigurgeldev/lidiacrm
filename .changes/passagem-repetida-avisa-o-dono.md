---
impacto: nada_mudou
secao: corrigido
titulo: Toda passagem nova para a equipe volta a avisar o dono — mesmo do cliente que já foi passado antes
---

O aviso no WhatsApp do dono (gatilho de fluxo "Quando a IA passar para uma
pessoa") só saía quando a passagem abria um cartão **novo** na Central. Se o
mesmo cliente ainda tinha um cartão aberto — de uma passagem antiga, devolvida
à IA antes de a devolução passar a fechar o cartão, ou nunca marcada como
resolvida — toda passagem seguinte dele era **silenciosa**: nenhum cartão novo,
nenhum gatilho, nenhuma mensagem.

E havia um segundo caminho mudo: a passagem feita pelo **sentimento baixo** do
cliente (ou pedida por uma ferramenta externa via MCP) nunca disparava o
gatilho — e o cartão que ela abria ainda calava o aviso da passagem seguinte.

Agora o aviso sai por **episódio**: sempre que um cliente que não estava com
a equipe passa a estar, o dono é avisado, pelos dois caminhos. Um cartão
vencido do mesmo cliente é encerrado para o novo nascer com o resumo de agora.
Dois caminhos escalando o mesmo cliente no mesmo minuto rendem um aviso só.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
