---
impacto: nada_mudou
secao: corrigido
titulo: Criar fluxo com IA falhava sempre em quem usa OpenRouter
---

Quem instalou apontando para a OpenRouter — o caminho recomendado — nunca
conseguiu criar um fluxo com IA. A tela aceitava a descrição, pensava por alguns
segundos e desistia, sem dizer por quê.

O motivo era um nome. O sistema chama o modelo de classificação de
`anthropic/claude-haiku-4-5`, com hífen antes do último número; a OpenRouter
chama o mesmo modelo de `anthropic/claude-haiku-4.5`, com ponto. O código
entregava o nome sem traduzir, apoiado num comentário que afirmava que os dois
eram iguais.

Pedir um modelo que não existe não devolve uma recusa clara: devolve uma
resposta que o sistema não consegue interpretar. O que sobrava para quem estava
na tela era uma mensagem sobre não entender o pedido — enquanto o pedido nunca
tinha chegado a modelo nenhum. Nem o registro do servidor ajudava, porque essa
chamada não registrava nada.

Agora existe a tradução, aplicada nos dois caminhos: no modelo padrão e no
modelo escolhido à mão na tela de provedores. Os outros modelos padrão já
coincidiam e seguem intactos.

Junto, essa chamada passou a registrar início, fim e falha, com a duração e o
nome do modelo. Era a peça que faltava para que um problema assim seja lido no
servidor em vez de reconstruído a partir do que a pessoa viu na tela.
