---
impacto: nada_mudou
secao: corrigido
titulo: Fluxo disparado por mensagem volta a distribuir o lead
---

Fluxo que começa por **mensagem recebida** ou **palavra-chave** e depois usa um
bloco que precisa do lead — distribuir (rodízio, fila na ordem, sorteio), passar
para outro vendedor, conferir se o vendedor respondeu — parava com o erro
`sem_lead_para_distribuir`, mesmo com o contato tendo lead aberto. O ramo
**Ninguém disponível** (que costuma avisar o gerente) nunca era alcançado.

Agora a execução usa o lead aberto do contato que mandou a mensagem. Nada para
configurar: os fluxos existentes passam a funcionar como foram montados.
