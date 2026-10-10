---
impacto: nada_mudou
secao: corrigido
titulo: Os limites de volume e custo por atendimento do agente passam a valer
---

A configuração do agente sempre teve **Volume de texto por atendimento** e
**Custo máximo por atendimento**. O agente nunca os respeitou: um atendimento
em que ele entrava em laço — consultando a mesma coisa de novo, tentando uma
ação que falhava — gastava até o teto de ações, com os dois campos salvos e
aparecendo na tela como se valessem.

Agora:

- **Quando um atendimento alcança o limite, o agente para de pensar.** Se ainda
  não tinha respondido o cliente, ele é obrigado a responder ou passar a
  conversa para a equipe numa última chamada — o limite nunca deixa o cliente
  sem resposta.
- **A Central avisa** quando o limite corta um agente, com os números e onde
  mexer. Fica um aviso aberto por agente, não um por atendimento.
- **Ao lado dos campos, a tela mostra quanto o agente de fato gasta**: nos
  últimos 30 dias, quanto metade dos atendimentos gastou, quanto 95% gastou, e
  quantos os limites que estão no formulário teriam cortado — dá para calibrar
  antes de salvar.
- O volume conta o texto **novo** de cada atendimento: as instruções que o
  provedor de IA relê do cache a cada passo não gastam o limite.
- O campo de custo agora diz a unidade certa: **centavos de dólar**, que é como
  o custo de IA é medido.
- O custo de IA passa a ser registrado por agente, que é o que alimenta o
  quadro acima. O histórico começa a contar a partir desta versão.

Os valores padrão (50.000 de volume, 50 centavos de dólar) foram pensados como
folga para atendimentos normais. Se o aviso aparecer com frequência para um
agente, suba o limite dele — a tela mostra quanto.

Nada muda para quem opera o servidor: não há mudança de banco nem passo manual.
