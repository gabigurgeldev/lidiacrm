---
impacto: capacidade_nova
secao: adicionado
titulo: O aviso de passagem para o dono pode chegar organizado, uma informação por linha
---

Quando a IA passa um cliente para a equipe, o motivo vem numa linha só, com os
campos separados por `|` (pedido, nome, telefone, itens, pagamento…). Colocado
direto no WhatsApp do dono, virava um bloco corrido difícil de ler.

O gatilho "Quando a IA passar para uma pessoa" agora também entrega
`{{event.reason_em_linhas}}`: a mesma informação, uma por linha, com o rótulo em
negrito e os itens do pedido em lista. Use no lugar de `{{event.reason}}` na
mensagem de aviso. Motivo em texto livre continua igual.
