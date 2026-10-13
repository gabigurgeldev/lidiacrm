---
impacto: nada_mudou
secao: corrigido
titulo: Voto ilegível na enquete acorda o agente, e a distribuição do fluxo entrega a conversa
---

**Enquete.** Quando o WhatsApp entregava um voto de enquete que não dava para
ler (`poll.vote.failed`), só abria um aviso na Central. O agente seguia mudo,
esperando uma escolha que não viria, e na mensagem seguinte do cliente ("eu
marquei aí") admitia que não via nada. Agora o voto ilegível também vira uma
entrada marcada na conversa: o agente acorda e pede, em uma frase, que o
cliente escreva a opção. A escolha numa **lista** também passou a ser lida em
conversas com mensagens temporárias, que embrulham a resposta num nível a mais.

**Distribuição pelo fluxo.** Os blocos "Definir o dono do lead" e os de
rodízio só gravavam o dono do card. O atendente sorteado não via a conversa na
caixa de entrada dele, e o rodízio não girava — ele conta as atribuições de
conversa, que ninguém registrava. Agora o dono escolhido pelo fluxo também
recebe a conversa aberta do cliente, com o registro de atribuição.

**Etapa por nome.** Mensagens de fluxo ganham `{{lead.stage_name}}` — o nome da
etapa, em vez do id — para o aviso ao atendente dizer "Pronto para fechar".

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
