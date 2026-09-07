---
impacto: nada_mudou
secao: corrigido
titulo: O botão de remover bloco sumia embaixo da dobra, e o bloco de início não saía de jeito nenhum
---

Dois defeitos no editor de fluxos, com a mesma consequência: blocos que não
saíam do quadro.

O botão "Remover este bloco" ficava **dentro da área que rola** do painel
lateral, empurrado para o fim do conteúdo. Em bloco de formulário curto ele
aparecia; em bloco de formulário longo — a decisão com várias saídas, o aviso no
WhatsApp com a caixa de mensagem de seis linhas — ele descia junto com o
conteúdo e ficava abaixo da dobra. Ninguém rola um painel que parece terminado,
então a leitura era "este bloco não tem como apagar". Agora o botão vive num
rodapé fixo do painel, sempre visível, com qualquer bloco selecionado.

O **bloco de início** era outro caso: ali o botão não estava escondido, estava
ausente — removido por regra, sem tooltip e sem nenhuma linha dizendo por quê.
Agora ele sai como qualquer outro, com um aviso antes: sem um bloco de início o
fluxo não pode ser publicado, porque não há o que o faça começar. O rascunho
continua podendo ser salvo, e outro bloco de início se pega na paleta, em
"Começo".

A tecla também passou a funcionar. Antes só `Backspace` apagava (era o padrão da
biblioteca do quadro) e `Delete` não fazia nada. Agora as duas apagam o bloco
selecionado — e nenhuma delas apaga bloco enquanto você está digitando num campo
do painel.

Publicar continua recusando fluxo sem bloco de início, com a mensagem ancorada
no quadro. E salvar um quadro que ficou sem bloco nenhum agora avisa em
português de operação, em vez do "Dados inválidos." que vinha do servidor.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
