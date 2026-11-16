---
impacto: nada_mudou
secao: corrigido
titulo: O agente voltou a conseguir anotar aprendizados na Memória da IA
---

A capacidade "Anotar uma regra aprendida" (`crm_save_org_memory`) falhava em
toda chamada: o banco recusava a origem que ela grava. O agente recebia erro e
nada era anotado.

Agora a anotação entra, e aparece em **Memória da IA** marcada como
*aprendido automaticamente* — antes, se tivesse entrado, a tela a mostraria
como *manual*. Como toda entrada ali, pode ser arquivada a qualquer momento.

A atualização aplica a correção do banco sozinha; não há nada a fazer.
