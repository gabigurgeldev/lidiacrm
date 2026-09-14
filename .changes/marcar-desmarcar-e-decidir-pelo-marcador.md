---
impacto: capacidade_nova
secao: adicionado
titulo: Marcar e desmarcar o cliente no fluxo, e decidir pelo marcador
---

O bloco **"Marcar o lead"** tinha um defeito que aparecia justamente no caminho
mais usado do produto: ele só sabia escrever no lead. Um fluxo que começa por mensagem de
WhatsApp **não tem lead** — tem contato. Nesses fluxos o bloco não marcava
ninguém, **não seguia para o bloco seguinte**, e a execução morria sem uma linha
de erro em lugar nenhum.

Agora ele se chama **"Marcar o cliente"** e marca quem existir: o lead quando o
fluxo tem um, o contato quando não tem. E ganhou um irmão,
**"Desmarcar o cliente"**, que faz o contrário — tirar o marcador de quem o
tiver.

Quando não há ninguém para marcar (nem lead, nem contato), o bloco deixou de
matar a execução: ele sai por uma saída própria, **"Não deu para marcar"**, e o
motivo aparece na trilha da execução. Falha visível em vez de sumiço.

**Decidir por "está marcado" ou "não está marcado".**

O bloco **"Decidir"** ganhou a pergunta pronta **"Tem o marcador"**. Escolhe-se
entre *Está marcado com* e *NÃO está marcado com*, digita-se o marcador (ou
clica-se num dos já usados na operação), e pronto — sem digitar nome de campo
nem escolher operador.

Por baixo ela pergunta pelos **dois lugares**, lead e contato. Escrita à mão,
essa pergunta era uma armadilha: perguntar só pelo lead responde "não" para todo
cliente que chegou pelo WhatsApp, e perguntar "não contém" num fluxo sem lead
responde **falso para quem de fato não tem o marcador**. Os dois erros seguiam
sem mensagem nenhuma: o fluxo simplesmente ia para sempre pelo mesmo lado.

Ainda no "Decidir", duas coisas que faltavam:

- dá para ter **mais de uma regra na mesma saída**, combinadas com **E** ou
  **OU** (havia um campo só, e nenhum botão para acrescentar);
- um marcador com cara de número — `2024` — deixou de virar número e passou a
  comparar como texto, que é o que ele é.

**Quem escuta o que o fluxo faz.**

Marcar e desmarcar pelo fluxo agora avisam o sistema (os mesmos avisos que a
automação antiga já emitia), então regras e webhooks que reagem a "ganhou uma
tag" enxergam também o que o fluxo fez. Um fluxo não dispara a si mesmo por
causa disso — a proteção contra laço já existia e passou a ser usada.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco. Fluxos já publicados continuam funcionando —
inclusive os que usam o bloco de marcar, que só passou a acertar mais casos.
