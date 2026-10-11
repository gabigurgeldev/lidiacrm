---
impacto: capacidade_nova
secao: corrigido
titulo: Coordenador devolve a conversa quando o fluxo termina, cala o fluxo que perdeu a vez e trata o cliente que volta como atendimento novo
---

Com o coordenador ligado (IA › Coordenador em **Conduzir**):

- **O fluxo que termina devolve a conversa.** Um fluxo que o coordenador
  escolheu, que um agente transferiu de vez ou que a equipe ativou, ao terminar
  sem o bloco "Entregar ao agente", deixava a conversa presa a ele: ninguém
  respondia até o cliente escrever de novo. Agora a conversa volta à decisão na
  hora e, se o cliente estava esperando resposta, o coordenador já escolhe quem
  responde.
- **O fluxo que perdeu a vez para de falar.** Quando o cliente interrompia um
  fluxo (uma regra mandou para outro destino), quando uma pessoa da equipe
  assumia ou quando outro agente recebia a conversa, o fluxo antigo continuava
  mandando as próximas mensagens — duas vozes na mesma conversa. Agora ele
  encerra calado. A opção "ao interromper: pausar ou cancelar" da política passa
  a valer. Fluxos que o coordenador nunca conduziu (automações de bastidor)
  seguem como antes.
- **Cliente que volta depois de uma pausa longa é atendimento novo.** Em
  Configurar › Limites, o campo novo "Cliente que volta depois de (horas) é
  atendimento novo" (padrão: 24 h; 0 desliga). Quem volta depois disso com uma
  mensagem curta ("quero cancelar") não fica mais automaticamente com o agente
  da conversa anterior: o modelo de decisão escolhe, e a troca não exige a
  confiança mínima.
- **O limite "Consultas ao modelo por hora" passa a valer de verdade.** As
  consultas que terminavam em "manter quem conduz" não eram contadas, e o limite
  nunca era atingido.

Também corrigido: o `supabase/baseline.sql` tinha um delimitador `$$` quebrado
(no bloco de tipos de mensagem) que impedia a instalação do zero de aplicar o
banco.

Nada a fazer no servidor: a mudança de banco vem na atualização normal, sem
variável nova e sem passo manual.
