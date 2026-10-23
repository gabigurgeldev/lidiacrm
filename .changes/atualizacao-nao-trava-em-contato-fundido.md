---
impacto: nada_mudou
secao: corrigido
titulo: Atualização do banco não trava mais por contato fundido
---

Quando dois contatos eram fundidos e o contato que ficou já tinha conversa no
mesmo número, a atualização do banco parava inteira em silêncio a cada deploy:
o sistema subia com o banco antigo e as novidades que dependiam de banco nunca
chegavam. Agora essa conversa fica onde estava e a atualização segue. Nada a
fazer na VPS.
