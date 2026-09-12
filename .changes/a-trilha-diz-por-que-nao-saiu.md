---
impacto: nada_mudou
secao: corrigido
titulo: A trilha da execução passou a dizer POR QUE a mensagem não saiu
---

Quando um bloco de envio não consegue mandar a mensagem, o fluxo **não morre**:
ele segue pela saída "Não saiu agora", que é o certo — o resto do fluxo costuma
continuar fazendo sentido.

Só que o motivo morria ali. O passo registrado guardava apenas por qual saída o
fluxo seguiu, e a trilha na tela desenhava só o nome do passo e o código do
bloco. O motivo real ia para um campo que nenhuma tela lê.

O efeito: o envio falhava, a execução aparecia **concluída**, e não havia uma
linha em lugar nenhum dizendo o que aconteceu. Quem testava via "não funcionou"
e não tinha o que reportar — nem para si mesmo, nem para quem fosse ajudar.

Agora, abrindo a execução, o passo que falhou mostra a frase e o erro:

> **A mensagem não saiu:** `meta_132001: template name does not exist`

Vale para os cinco casos que recusam em silêncio: mensagem ao cliente, aviso ao
vendedor, criação de campanha, entrega ao agente, e a mensagem que fica na fila
do canal (essa não é falha — é espera, e agora aparece como tal).

Só o diagnóstico do próprio sistema vai para lá. O que o cliente escreveu
continua fora do registro de passos, porque esse registro não é alcançado pela
anonimização da LGPD — e essa fronteira está presa por teste.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
