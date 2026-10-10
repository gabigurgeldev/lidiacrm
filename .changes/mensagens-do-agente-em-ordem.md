---
impacto: nada_mudou
secao: corrigido
titulo: As mensagens do agente chegam na ordem em que ele escreveu
---

Quando o agente mandava duas mensagens seguidas, às vezes a segunda chegava
antes da primeira. O cliente recebia "Quer algum adicional?" antes de "Anotei
1 litro de açaí", respondia fora de contexto, e o agente acabava perguntando a
mesma coisa de novo.

Agora as mensagens de um mesmo turno saem uma de cada vez, na ordem em que o
agente as escreveu.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
