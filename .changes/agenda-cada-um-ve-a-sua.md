---
impacto: exige_acao
secao: alterado
titulo: Agenda — cada atendente vê a sua, e dá para marcar horário direto da conversa
---

A Agenda passou a respeitar quem está olhando:

- **Atendente** (papel `agent`) e **visualizador** veem a **própria agenda**: os
  atendimentos em que são a profissional (principal ou apoio) e os que eles mesmos
  marcaram. A tela vira **"Minha agenda"**, sem o filtro de pessoas.
- **Gerente** e **administrador** continuam vendo a agenda da equipe inteira, com o
  filtro por pessoa e a visão por profissional.

A regra vale no banco, não só na tela: nem a API nem o acesso direto ao banco pela
chave pública entregam o agendamento de um colega. O nome dos compromissos pessoais
do Google Agenda também deixou de ser legível por colegas — só a própria pessoa e a
gerência o leem; na grade ele continua aparecendo como "Ocupado".

**Marcar horário pela conversa.** No inbox, o menu ⋮ da conversa e o painel do
contato ganharam **"Marcar horário"**: escolhe o tipo, vê os horários livres e marca
com o cliente da conversa já preenchido. A profissional padrão é quem está logado;
dá para escolher um colega — aí aparecem só os horários livres dele, e o
agendamento fica na agenda do colega (quem marcou também o vê). O painel do contato
mostra os **próximos horários** daquele cliente.

**A IA marca na agenda de quem está atendendo.** Quando a conversa tem um atendente
humano e o cliente não pediu ninguém, a IA oferece e marca primeiro com esse
atendente; se ele não faz o serviço ou está ocupado, vale o primeiro livre, como
antes.

Também na Agenda: um resumo do dia no topo (quantos hoje, o próximo, quantos
aguardando confirmação); no mês, clicar no dia abre a visão do dia; os blocos
"Ocupado" do Google não somem mais depois de alguns segundos; e quem só visualiza
não vê mais botões que não pode usar.

## Requer atenção

Se a **recepção** da sua organização tem papel de **atendente** e precisa enxergar a
agenda de todos (para distribuir horários, confirmar consultas da equipe), promova
essas pessoas a **gerente** em **Equipe**. Depois da atualização, atendentes deixam
de ver os agendamentos dos colegas.
