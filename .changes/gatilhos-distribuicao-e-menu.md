---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxos ganham gatilhos novos, duas formas de distribuir e menu de escolha
---

Até aqui um fluxo só podia começar de um jeito: quando um lead novo entrava no
funil. Agora há mais três começos.

"Quando o cliente manda mensagem" dispara a cada mensagem recebida. "Quando o
cliente escrever uma palavra" dispara só quando a mensagem traz uma das
palavras que você listar — acento e maiúscula não fazem diferença, e dá para
exigir que a mensagem seja exatamente a palavra, o que é o certo para menu por
número (assim "10 reais" não aciona a opção "1"). "Quando outro sistema chamar"
cria um endereço que um sistema de fora pode chamar para começar o fluxo; o
endereço nasce quando você publica, aparece em Canais › Webhooks, e não muda
quando você publica de novo — dá para colar no outro sistema uma vez só.

Na distribuição, além do rodízio que já existia, dois blocos novos. "Sortear um
vendedor" escolhe por acaso entre quem está disponível — serve quando você não
quer que a equipe saiba de quem é a vez, e vale saber que sorteio concentra:
três leads seguidos para a mesma pessoa é resultado normal. "Distribuir em
fila, na ordem" percorre uma ordem que você monta na tela, um lead por vez,
dando a volta no fim; quem estiver indisponível na hora é pulado, e a vez dele
não se perde. É a ordem que você escreveu que vale, mesmo quando ela não é a
mais "justa" — times costumam ter uma ordem combinada que o sistema não conhece.

"Entregar a conversa para a IA" devolve o atendimento ao agente. Ele desfaz a
passagem para uma pessoa, inclusive quando foi um atendente que assumiu a
conversa — o painel do bloco avisa isso antes de você publicar.

E "Esperar uma escolha" espera a resposta do cliente e segue pelo caminho da
opção que ele escolheu. Você define as opções e o que o cliente pode escrever
para cada uma ("1", "sim", "quero"). Ele tem duas saídas de exceção separadas,
porque são situações diferentes: "não respondeu a tempo" pede insistir, e "não
entendi a resposta" pede repetir a pergunta de outro jeito. Este bloco só
ESPERA — a pergunta com as opções sai de um bloco de mensagem antes dele.
