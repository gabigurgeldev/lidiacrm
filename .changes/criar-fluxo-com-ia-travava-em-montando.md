---
impacto: nada_mudou
secao: corrigido
titulo: Criar fluxo com IA travava em "Montando N blocos" e nunca terminava
---

Ao pedir um fluxo à IA, o quadro recebia os blocos certos em segundos e a barra
de progresso começava a andar — e parava ali. "Montando N blocos…" para sempre,
sem erro, sem mensagem, sem fim. Tentar de novo dava no mesmo.

A causa não estava na inteligência artificial, e é por isso que ela sobreviveu a
quatro correções. Todas procuraram no mesmo lugar: o modelo, o formato do pedido,
o nome do provedor. Medindo contra o provedor de verdade, nenhuma chamada
falhava — o planejamento respondia em 11 segundos e cada bloco em 4 ou 5, todos
corretos.

O que falhava era o **transporte**. Aquela segunda etapa era a única parte do
sistema que devolvia a resposta em fatias, ao vivo, para os blocos acenderem um
a um na tela. Esse formato depende de o servidor intermediário da hospedagem
deixar as fatias passarem na hora — e o servidor de uma VPS típica junta tudo e
só entrega no fim, ou desiste antes disso. Como o navegador nunca recebia a
primeira fatia, a barra ficava parada em zero, e como a resposta já tinha
começado com "sucesso", nenhum erro chegava à tela. O próprio sintoma dizia
isso: a frase "Montando N blocos" só aparece **depois** que a primeira etapa
respondeu, e essa é uma resposta comum — ou seja, o caminho normal atravessava a
hospedagem e o caminho ao vivo não.

Agora as duas etapas são respostas comuns. Você descreve, a IA monta, e o fluxo
aparece pronto no quadro. **Some o progresso bloco a bloco** — em lugar dele há
uma barra de atividade e o aviso de quantos blocos estão sendo montados. Um
fluxo de 8 blocos leva cerca de 10 segundos; um de 20, cerca de 25.

Três coisas melhoraram junto:

- **Quando dá errado, a tela diz o motivo.** Antes, qualquer causa virava a mesma
  frase genérica, porque uma resposta ao vivo que quebra no meio não tem como
  informar o que houve. Agora "nenhum provedor configurado" — que se resolve com
  um clique — deixa de parecer o mesmo problema que "o modelo recusou o pedido".
- **Falhar não apaga mais o seu fluxo.** Se a montagem não vier, os blocos que a
  IA planejou **ficam no quadro**, ligados, com valores padrão, e a tela diz isso
  com todas as letras e oferece fechar para você preencher à mão. Antes o quadro
  era limpo e você ficava sem nada.
- **Os caminhos de uma decisão param de trocar de lugar.** Num bloco que decide
  ("já responderam ao cliente?"), o nome de cada saída era escolhido duas vezes,
  em momentos separados, e às vezes saía diferente — aí a seta ia para o caminho
  errado, sem nenhum aviso: o fluxo parecia certo na tela e se comportava errado
  com o primeiro cliente. Agora o nome é decidido uma vez só e reaproveitado.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança no banco.
