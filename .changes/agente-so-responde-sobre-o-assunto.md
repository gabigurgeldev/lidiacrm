---
impacto: capacidade_nova
secao: corrigido
titulo: "Só responder sobre…" passa a valer — e dois agentes no mesmo número dividem o atendimento pelo assunto
---

O editor do agente tinha um campo para responder só sobre um assunto, mas o
atendimento nunca o consultava: o agente respondia a tudo, e com dois agentes
no mesmo número atendia sempre o de maior prioridade.

Agora:

- O campo se chama **Só responder sobre…** e recebe palavras separadas por
  vírgula (ex.: `pedido, entrega, segunda via`). Acento e maiúscula não
  importam. Quem conhece expressão regular pode usar o modo avançado.
- O agente olha tudo o que o cliente escreveu desde a última resposta — quem
  manda "oi", "queria saber" e "do meu pedido" em três mensagens é entendido.
- Com vários agentes no mesmo número (sem roteador), atende o primeiro, por
  prioridade, que aceita o assunto. Agente sem filtro aceita tudo.
- Conversa que um agente já está atendendo continua com ele por 24 horas, mesmo
  que a mensagem nova não repita o assunto ("pode ser terça?").
- Se nenhum agente do número aceita o assunto, ninguém responde, e a conversa
  fica na Inbox para a equipe.
- O botão **Testar** avisa quando a mensagem de teste está fora do assunto.
- Expressões que podem travar o atendimento (como `(a+)+`) são recusadas ao
  salvar, com o motivo. Uma expressão assim salva antes desta versão é ignorada
  — o agente responde como se não houvesse filtro.
- Agente que faz parte de um roteador mostra que o filtro não vale para ele:
  quem decide o assunto é o roteador.

**Confira depois de atualizar:** se algum agente seu tem esse campo preenchido,
ele passa a responder só sobre aquele assunto. Para manter o comportamento
anterior, deixe o campo em branco.

Não há mudança de banco nem passo manual.
