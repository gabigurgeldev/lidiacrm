---
impacto: nada_mudou
secao: corrigido
titulo: Uma aba sem sessão no tempo real não trava mais o CRM de todos
---

Com o servidor lento, uma aba podia ficar conectada ao tempo real sem sessão.
Isso parava as atualizações ao vivo de todas as organizações e fazia a aba
reler o inbox cerca de uma vez por segundo, saturando a VPS. Agora a aba não
se conecta sem sessão e reconecta com espera crescente.
