---
impacto: nada_mudou
secao: corrigido
titulo: A Atividade do coordenador mostra também as decisões que mantêm quem conduz, com o erro quando o modelo falha
---

O coordenador consulta o modelo de decisão a cada mensagem, mas a aba
**IA › Coordenador › Atividade** só registrava quando a conversa TROCAVA de
responsável. Quando o modelo escolhia quem já conduzia — o caso mais comum —, a
decisão não aparecia em lugar nenhum, e a tela ficava parada na última troca.
Uma falha antiga ("O modelo de decisão falhou") podia ficar dias sozinha na
lista enquanto o modelo decidia toda mensagem normalmente.

Agora toda decisão que consultou o modelo aparece, inclusive a que manteve o
responsável (selo **Mantida**, "Fulano continua conduzindo"), com o modelo usado,
o que ele escolheu e a confiança. Quando o modelo falha, a linha mostra o erro
que ele devolveu — e a aba Simular também. Os limites de transferência continuam
contando só trocas de verdade.

Nada muda para quem opera o servidor: a mudança de banco (migration 0238, um
valor novo aceito em `coord_transicoes.status`) chega pelo `update.sh` de
sempre, sem variável nova nem passo manual.
