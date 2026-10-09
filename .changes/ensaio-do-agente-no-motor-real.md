---
impacto: nada_mudou
secao: adicionado
titulo: Base do novo teste do agente — o ensaio roda o atendimento de verdade, sem enviar nada
---

Preparação para o novo botão **Testar** do editor de agentes (que chega na
próxima versão). O teste antigo rodava um motor diferente do que atende os
clientes: aprovava respostas que no atendimento real nunca sairiam, e as ações
do agente — mover card, marcar consulta — aconteciam de verdade no CRM.

O novo ensaio roda **o mesmo atendimento** que o agente faz no WhatsApp, com o
que está no formulário (mesmo sem salvar), e desfaz tudo no fim:

- **Nada é enviado** ao cliente e **nada fica gravado** no CRM — nem contato,
  nem conversa, nem as ações que o agente tentou.
- As ações do CRM aparecem como **simuladas**, com o que o agente escolheu.
- O teste **não atrasa** o atendimento real do mesmo número.
- **O custo de IA é real** e entra no consumo da organização, marcado como
  teste.

Nesta versão nada muda na tela: o botão Testar continua o mesmo até a próxima.
