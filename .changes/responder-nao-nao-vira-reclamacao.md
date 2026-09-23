---
impacto: nada_mudou
secao: corrigido
titulo: Responder "não" deixou de ser tratado como cliente insatisfeito
---

Quem respondia **"não"** a uma pergunta do atendimento automático era tratado
como cliente irritado. A conversa saía do atendimento por IA, ia para a fila de
humanos, e a pessoa recebia de volta uma mensagem dizendo que não havia
atendente disponível e que ela tinha entrado na fila — sem ter pedido nada
disso.

Medido numa instalação real: as mensagens `Não`, `não` e `Vou não` receberam
nota 0,15 do classificador de humor, numa escala em que abaixo de 0,3 o sistema
entende que o cliente está insatisfeito e chama uma pessoa.

**O classificador não errava por pouco, errava de pergunta.** "Não" sozinho não
diz nada sobre o humor de ninguém: é uma resposta. O modelo recebia uma palavra
de carga negativa, sem nada em volta, e pontuava no fundo da escala.

O conserto tem duas camadas:

- respostas de sim/não enviadas sozinhas ("não", "sim", "ok", "beleza", "hoje
  não", "vou não" e companhia) **não são mais enviadas ao classificador**. Não
  há humor a medir ali, e não medir é mais barato e mais confiável do que medir
  errado;
- para as frases que têm contexto, o classificador passou a receber a regra
  explícita de que **recusar não é reclamar**: "não quero isso" e "hoje não dá,
  obrigado" são respostas educadas, não queixas. Só desce a nota quem demonstra
  estar chateado.

Reclamação curta continua sendo tratada como reclamação — "péssimo", "lixo",
"cancela tudo" e "quero meu dinheiro de volta" seguem chamando uma pessoa. Essa
metade é vigiada por teste próprio: trocar o falso alarme barulhento por um
silêncio na hora errada seria pior do que o defeito original.

**Nada muda para quem opera o servidor.** Sem variável nova, sem passo de
atualização, sem mudança de banco.
