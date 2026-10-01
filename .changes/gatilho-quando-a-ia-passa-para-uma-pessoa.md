---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxo que começa quando a IA passa a conversa para uma pessoa
---

Novo gatilho nos Fluxos: **Quando a IA passar para uma pessoa**. Ele dispara uma
vez por passagem (pedido do cliente, decisão do agente, teto de gasto) e deixa a
mensagem usar `{{contact.name}}`, `{{contact.phone_number}}`, `{{event.reason}}`
e `{{event.summary}}`.

Com o bloco **Avisar o vendedor no WhatsApp** apontado para um número, o dono
recebe no celular quem é o cliente, o número e o resumo da conversa, e assume
pelo CRM.
