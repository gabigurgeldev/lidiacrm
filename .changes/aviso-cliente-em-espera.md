---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxo pode avisar quando um cliente que espera a equipe escreve de novo
---

Quando o agente de IA passa um cliente para a equipe, ele fica calado com esse
cliente até alguém devolver a conversa. Se o cliente escrevia de novo nesse
meio-tempo, ninguém respondia — e ninguém era avisado, porque o aviso ao dono
só saía numa passagem nova.

O gatilho **"Quando o cliente manda mensagem"** ganhou a opção **"Só quando o
cliente está esperando a equipe"**. Ligada a um bloco "Avisar o vendedor no
WhatsApp", ela avisa a equipe sempre que um cliente em espera manda
mensagem. Um cliente que manda várias mensagens seguidas gera um aviso só (o
intervalo mínimo entre avisos é ajustável, 30 minutos por padrão).

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
