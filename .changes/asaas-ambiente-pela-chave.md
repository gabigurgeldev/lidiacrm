---
impacto: nada_mudou
secao: corrigido
titulo: Cobrança pelo Asaas escolhe produção ou teste pela própria chave
---

Quem cola a chave de produção do Asaas (`aact_prod_…`) passa a falar com o Asaas
de produção mesmo que `ASAAS_AMBIENTE` tenha ficado como `sandbox` ou escrito de
outro jeito (`produção`, `production`). Antes isso caía no ambiente de teste em
silêncio e o pagamento aparecia como "cartão recusado". Uma chave recusada pelo
Asaas agora aparece como problema de configuração, e não como cartão recusado.
O guia `docs/integracoes/asaas.md` ganhou o passo a passo da virada para produção.
