---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxos passaram a fazer coisas ao mesmo tempo, repetir e esperar um acontecimento
---

Até agora um fluxo era uma linha única: um bloco de cada vez, do início ao fim,
sem voltar. Dava para decidir entre caminhos, mas nunca para seguir por dois
caminhos ao mesmo tempo, nunca para repetir, e nunca para ficar parado
esperando que algo acontecesse — só esperar um tempo fixo no relógio.

Cinco blocos novos na paleta do construtor de fluxos:

- **Fazer ao mesmo tempo** — o fluxo segue por vários caminhos de uma vez. Você
  escolhe como eles se juntam de novo: *esperar todos terminarem*, ou *seguir
  com o primeiro que terminar*. A segunda opção é a que escreve "espera o
  cliente responder **ou** o prazo vencer": quando um caminho vence, os outros
  são cancelados na hora.
- **Reencontro** — onde os caminhos voltam a ser um só. É ele que a bifurcação
  aponta.
- **Repetir para cada** — percorre uma lista item a item. O número máximo de
  repetições é obrigatório, e é ele que garante que a repetição termina mesmo se
  a lista vier maior do que você esperava.
- **Esperar acontecer** — o fluxo fica parado até o cliente responder (ou o lead
  mudar de etapa, ser ganho, ser perdido), com um prazo. Vencido o prazo, ele
  segue por uma saída própria, "Venceu o prazo". Antes só existia esperar um
  tempo fixo, que é diferente: dava para esperar duas horas, não dava para
  esperar *a resposta*.
- **Chamar outro fluxo** — roda outro fluxo como sub-rotina e espera ele
  terminar. Serve para não repetir o mesmo pedaço em dez fluxos diferentes.

Duas coisas que os blocos das mensagens ganharam junto, e que valem para todos
os fluxos:

- **`{{event.…}}` finalmente tem conteúdo.** O que disparou o fluxo agora chega
  inteiro até os blocos. Um fluxo que começa por "mensagem recebida" pode usar o
  **texto da mensagem**; um que começa por webhook pode usar o que o outro
  sistema mandou. Antes só sobravam o lead e o contato, e o resto se perdia — o
  que tornava metade dos gatilhos decorativa.
- **`{{global.…}}` é o que é igual em todos os fluxos da sua empresa.** Guardado
  uma vez nas configurações da organização, em `flow_globals`. Trocar o telefone
  do suporte passa a ser um lugar só, em vez de trinta fluxos.

O que muda na publicação: um fluxo que forma um círculo continua sendo recusado,
**exceto** quando o círculo passa por um bloco de repetição — que tem fim
declarado. E uma bifurcação cujo reencontro não existe (ou aponta para um bloco
que não é reencontro) passa a ser recusada na publicação, em vez de virar um
fluxo que se divide e nunca mais se junta.

Nada a fazer: a atualização aplica sozinha as tabelas novas, os fluxos que já
existem continuam funcionando exatamente como antes, e as execuções que
estiverem em andamento no momento da atualização não são perdidas nem
reiniciadas — elas continuam de onde pararam. Nenhuma variável de ambiente nova.
