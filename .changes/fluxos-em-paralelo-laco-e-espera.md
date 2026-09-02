---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxos passaram a fazer coisas ao mesmo tempo, repetir e esperar um acontecimento
---

Até agora um fluxo era uma linha única: um bloco de cada vez, sem voltar. Cinco
blocos novos na paleta:

- **Fazer ao mesmo tempo** — segue por vários caminhos de uma vez, e você
  escolhe se ele espera *todos* terminarem ou segue com o *primeiro*. A segunda
  opção escreve "espera o cliente responder **ou** o prazo vencer": quando um
  vence, os outros são cancelados na hora.
- **Reencontro** — onde os caminhos voltam a ser um só.
- **Repetir para cada** — percorre uma lista item a item, com um máximo de
  repetições obrigatório.
- **Esperar acontecer** — fica parado até o cliente responder (ou o lead mudar
  de etapa, ser ganho, ser perdido), com prazo. Antes só dava para esperar um
  tempo fixo; não dava para esperar *a resposta*.
- **Chamar outro fluxo** — roda outro fluxo e continua quando ele terminar.

E o que disparou o fluxo agora chega inteiro aos blocos: um fluxo que começa por
"mensagem recebida" pode usar o **texto da mensagem**. Antes só sobravam o lead e
o contato.

Nada a fazer: a atualização aplica sozinha as tabelas novas, os fluxos que já
existem seguem funcionando, e as execuções em andamento continuam de onde
pararam.
