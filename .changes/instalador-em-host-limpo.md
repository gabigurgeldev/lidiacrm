---
impacto: nada_mudou
secao: corrigido
titulo: A instalação numa VPS nova vai até o fim
---

A primeira instalação num servidor limpo parava duas vezes, e nas duas o
instalador mandava apagar a configuração e recomeçar — receita errada, porque
nada estava pela metade.

A primeira parada acontecia ao criar o seu usuário de administrador. O banco
recusava o comando com `"language" is not a known variable`, uma mensagem que
não tem relação nenhuma com o que estava sendo feito: um comentário dentro do
script terminava sendo executado como se fosse um comando, e a saída dele era
despejada no meio da instrução que criava o usuário.

A segunda acontecia no último passo, ao ligar as automações. O instalador
gravava o disparo do processamento de eventos e morria em seguida, sem
mensagem nenhuma, antes de instalar o agente que faz o botão "Atualizar agora"
funcionar pela tela. A causa era o servidor ainda não ter nenhuma tarefa
agendada — condição que só existe na primeira instalação de cada máquina, e que
some sozinha na segunda tentativa. Era por isso que rodar o instalador de novo
"resolvia": o problema tinha sido criado e apagado pela própria primeira
execução.

Quem já tem o CRM instalado não é afetado: os dois defeitos só aparecem em
servidor onde nada foi instalado antes.
