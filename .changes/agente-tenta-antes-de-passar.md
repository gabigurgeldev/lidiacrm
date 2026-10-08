---
impacto: capacidade_nova
secao: adicionado
titulo: O agente pode tentar resolver uma vez antes de passar o cliente que pediu uma pessoa
---

Até aqui, quando o cliente escrevia "quero falar com um atendente", a
conversa ia para a equipe na hora, antes de o agente dizer qualquer coisa.
Muita gente pede uma pessoa por hábito, logo no primeiro "oi" — e o agente,
que resolveria a dúvida ensinando o passo a passo, nunca chegava a falar.

Agora há uma opção no agente, em **Passar para uma pessoa**: "Quando o
cliente pedir uma pessoa, tentar resolver uma vez antes". Ligada, o agente
oferece ajuda uma vez, já mostrando o primeiro passo. Se o cliente insistir,
a conversa passa para a equipe na hora — essa passagem é garantida pelo
sistema, não depende de o agente obedecer a uma instrução.

Desligada (o padrão), nada muda: o pedido de pessoa passa na hora, como
sempre. Só funciona com "Deixar o agente chamar uma pessoa" ligado.

Para quem opera o servidor: a atualização aplica sozinha a mudança de banco
(coluna nova com padrão). Nenhum passo manual.
