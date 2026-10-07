---
impacto: capacidade_nova
secao: adicionado
titulo: O fluxo entrega a conversa à IA com o que o cliente contou, e a IA responde na hora
---

O bloco **"Entregar a conversa para a IA"** ganhou três opções, pensadas para
o fim de um pré-atendimento:

- **O que a IA precisa saber:** um texto com variáveis — por exemplo
  `Nome: {{vars.nome}} / Sistema: {{vars.sistema}} / Problema: {{vars.problema}}`.
  Ele entra no resumo que o agente lê antes de toda resposta, e o agente
  começa sabendo o que o cliente já contou, sem repetir perguntas.
- **A IA responde na hora:** o agente fala assim que o fluxo termina. Antes,
  ele só respondia quando o cliente mandasse outra mensagem.
- **Não tirar a conversa de uma pessoa:** se alguém da equipe assumiu, ou a
  conversa foi passada para a equipe durante o fluxo, o bloco segue pela nova
  saída "Uma pessoa já assumiu" em vez de devolver à IA.

Blocos já publicados não mudam: todas as opções nascem vazias ou desligadas.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
