---
impacto: nada_mudou
secao: corrigido
titulo: A distribuição automática não abandona mais a conversa que ninguém pôde receber
---

Medido em produção: quando ninguém podia receber uma conversa nova (ninguém
marcado como disponível, todas as atendentes no limite de capacidade, ou fora do
ar porque "Sempre disponível" estava desligado e o CRM fechado), a distribuição
tentava por alguns minutos e desistia. A conversa ficava sem dono **para
sempre**, mesmo depois de a equipe voltar. No modo de visibilidade "só as
minhas", nenhuma atendente a enxergava: o cliente escrevia e ninguém via.

Agora a conversa espera na fila. Depois das tentativas rápidas, a distribuição
segue conferindo a cada 10 minutos e entrega a conversa à primeira pessoa que
puder recebê-la. A espera termina sozinha quando alguém assume a conversa, quando
ela é encerrada ou quando a distribuição automática é desligada.

Em **Configurações › Atendimento**, o campo "Tentativas antes de desistir" passa
a se chamar **Tentativas rápidas**, porque o sistema não desiste mais.

Nada muda para quem opera o servidor: sem passo de atualização, sem mudança de
banco. Conversas que já tinham ficado sem dono antes desta versão continuam sem
dono; atribua-as pela fila do Inbox.
