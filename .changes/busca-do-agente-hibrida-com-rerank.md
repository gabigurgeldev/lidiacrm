---
impacto: capacidade_nova
secao: adicionado
titulo: A busca do agente acha código e produto pelo nome, e reordena com rerank
---

O agente passou a buscar no material por significado **e** por palavra: código
de produto, SKU e número de pedido que antes escapavam agora são encontrados.
Quando a organização (ou a instalação) tem chave da OpenRouter, os resultados
são reordenados por um modelo de rerank antes de chegar ao agente. Sem chave, a
busca funciona como antes, só que híbrida.

A busca de produtos da loja passou a achar pelo que o cliente descreve ("vestido
longo azul"), não só pelo nome exato, e o agente ganhou uma busca por assunto
nas notas que guarda sobre cada cliente.

Corrigido: sincronizar um produto ou um lote de conversas não apaga mais o resto
do catálogo da busca. Versões antigas do material são limpas sozinhas depois de
7 dias.

Nada a fazer para atualizar. Para desligar o rerank: `RERANK_DESLIGADO=1` no
`.env`; para trocar o modelo: `RERANK_MODEL`.
