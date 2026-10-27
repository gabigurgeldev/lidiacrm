---
impacto: nada_mudou
secao: corrigido
titulo: A distribuição automática espera o horário voltar em vez de desistir
---

Medido em produção, numa equipe de três atendentes: a distribuição parou de
entregar conversas logo no primeiro dia, e o fluxo de distribuição passou a cair
sempre em "ninguém disponível". Eram dois defeitos somados.

- **Lead que chegava no almoço, à noite ou no fim de semana nunca era
  distribuído.** Sem ninguém no horário, o rodízio tentava 5 vezes em 5 minutos e
  desistia — e a conversa ficava sem dono para sempre. No modo de visibilidade
  "só as minhas", nenhuma atendente a enxergava. Agora, se alguém disponível só
  está fora do horário, a distribuição volta exatamente quando a primeira jornada
  abrir, sem gastar tentativa.
- **A tela de Equipe mostrava "Online" para quem estava lotada.** A distribuição
  só entrega a quem tem menos conversas abertas do que a capacidade (padrão: 5).
  Com 44 conversas abertas, a atendente aparecia Online e não recebia nada, sem
  nada na tela explicando por quê. Agora o selo diz **Lotada**, com a explicação
  ao passar o mouse.

Nada muda para quem opera o servidor: sem passo de atualização, sem mudança de
banco. Se a sua equipe atende muitas conversas ao mesmo tempo, aumente a
**Capacidade** de cada atendente em Equipe › Atendimento.
