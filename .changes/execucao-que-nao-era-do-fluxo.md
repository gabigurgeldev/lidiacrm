---
impacto: nada_mudou
secao: corrigido
titulo: Mensagem que não era para o fluxo deixou de aparecer como erro — e agora diz o que comparou
---

Um fluxo que começa por PALAVRA é avaliado a cada mensagem que chega: o sistema
abre a execução e o bloco decide se aquela mensagem era para ele. Quando não
era, a execução encerrava — e a tela de Execuções pintava isso de **vermelho**,
"Parou com erro", com um código embaixo (`mensagem_sem_a_palavra`) e mais um
aviso na Central dizendo "Automação parou".

Numa instalação com cem mensagens por dia e um fluxo por palavra, eram cem
alarmes falsos por dia. Dois estragos, e o segundo é o pior:

- **O vermelho perdia o sentido.** Quem vê cem alarmes falsos para de olhar — e
  a falha de verdade chega no meio deles.
- **Não dava para diagnosticar nada.** A tela era idêntica nos dois casos que
  mais importa separar: "a mensagem não era para este fluxo" e "o texto da
  mensagem não chegou ao bloco". O segundo já aconteceu neste produto, matou
  100% das execuções daquele gatilho, e durou justamente porque a tela não
  distinguia um do outro.

Agora a execução aparece com um selo neutro, **"Não era para este fluxo"**, e
uma frase que diz o que foi comparado:

> recebi "bom dia"; a mensagem tinha de conter: orçamento, preço

Com isso, "recebi nenhum texto" numa mensagem de texto de verdade vira um sinal
visível de defeito, em vez de se confundir com o caso normal. O modo também é
nomeado — "a mensagem inteira tinha de ser" contra "a mensagem tinha de conter"
—, que é a confusão mais comum de quem monta o bloco.

**O alarme não foi desligado, só apontado.** Falha de verdade — funil sem etapa,
fila sem ninguém na ordem, marcador em branco, grafo inválido — continua
vermelha e continua abrindo aviso na Central.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
