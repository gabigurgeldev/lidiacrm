---
impacto: nada_mudou
secao: corrigido
titulo: "Criar agente com IA" não trava mais na primeira tela
---

Depois de colar o texto sobre o negócio e clicar em **Continuar**, algumas
pessoas recebiam erro a cada tentativa e não conseguiam passar da primeira tela.

A causa: às vezes a IA respondia "ainda tenho perguntas" sem mandar pergunta
nenhuma, ou "já dá para montar" sem dizer o que ia montar. O sistema tratava
isso como falha e devolvia erro, e com o mesmo texto o erro se repetia.

Agora, quando isso acontece, a entrevista simplesmente termina e o agente é
montado com o que foi contado. O que ficou faltando vira assunto que o agente
passa para uma pessoa, do mesmo jeito que já acontecia quando as rodadas de
perguntas acabavam.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
