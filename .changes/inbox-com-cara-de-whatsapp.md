---
impacto: nada_mudou
secao: alterado
titulo: O Inbox ganhou cara de aplicativo de mensagens
---

A tela onde se atende o dia inteiro foi refeita por fora. Nada do que ela fazia
mudou: as mesmas conversas, os mesmos botões, as mesmas permissões, o mesmo
envio.

**A conversa.** As mensagens agora têm a pontinha do balão, agrupam por quem
falou — três mensagens seguidas da mesma pessoa viram um bloco, e não três
interrupções — e a hora ficou dentro do balão, ao lado do texto, em vez de numa
linha própria embaixo. O fundo deixou de ser liso: ganhou um padrão bem
discreto, desenhado para este produto, para a conversa não flutuar no vazio.

**Os áudios.** O tracinho fino de progresso virou barras, com o botão de tocar
redondo e maior. A velocidade (1x, 1,5x, 2x) só aparece depois que você dá play
— antes disso ela não responde a pergunta nenhuma. O controle continua o mesmo
por baixo: dá para arrastar, e dá para usar as setas do teclado.

**As barras não são o desenho do som.** Elas são estáveis por mensagem e
mostram o quanto já tocou; ler a forma real do áudio exigiria decodificar o
arquivo inteiro, e num áudio de quatro minutos isso trava a página.

**A coluna de conversas.** Busca, número, tag, visões e o interruptor de "não
lidos" ocupavam quase um quarto da altura. Agora as visões (Fila, Minhas,
Todas, Fechadas, IA) são pílulas com a contagem em bolinha, e a tag e o "apenas
não lidos" recolheram atrás de um botão de filtros — que mostra um número quando
há filtro ligado, para nenhum filtro esquecido encurtar a lista em silêncio.

**Cada número diz de que tipo é.** No seletor, ao lado do nome, aparece o logo
do WhatsApp e se aquele número foi conectado **por QR code** ou é o
**canal oficial** da Meta. A diferença é prática: no oficial existe a janela
de 24 horas
— fora dela só sai modelo aprovado — e no número por QR não existe. Até agora os
dois eram indistinguíveis na hora de escolher.

**As fotos das pessoas.** Elas já eram baixadas, mas apareciam só na lista de
conversas. Agora aparecem também no topo da conversa e no painel do contato. E,
ao abrir uma conversa de alguém cuja foto nunca foi buscada, o sistema busca na
hora, em vez de esperar a varredura periódica chegar nele (o que podia levar
dez minutos). Quem não tem foto passa a mostrar a silhueta cinza, como no
WhatsApp, no lugar das iniciais.

*Contato sem foto pública continua sem foto: o sistema não inventa um rosto que
o WhatsApp não entrega.*

**A barra do topo some no Inbox.** Enquanto você está na tela de conversas, o
cabeçalho do sistema sai da frente e a conversa ocupa a altura toda — como no
WhatsApp Web. O sino, o idioma, o tema e o seu avatar descem para o rodapé do
menu lateral, e o cabeçalho volta sozinho ao mudar de página. No celular ele
continua onde estava, porque é lá que fica o botão que abre o menu.

**Um erro de altura foi corrigido junto.** A grade do Inbox calculava a própria
altura a partir do tamanho da margem da página, e essa margem mudou na versão
anterior: em telas menores que 1024px o rodapé — onde se escreve — nascia
parcialmente fora da tela. A altura deixou de ser uma conta e passou a ser o
espaço que sobra.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança no banco.
