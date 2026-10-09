---
impacto: nada_mudou
secao: corrigido
titulo: O agente não termina mais um atendimento sem responder ao cliente
---

O agente só fala com o cliente por uma ferramenta própria de envio — tudo o que
ele escreve fora dela é descartado, de propósito, porque só sai o que passa
pelas conferências de segurança. Às vezes o modelo escrevia a resposta como
texto comum, ou simplesmente encerrava: o atendimento aparecia como concluído,
nenhuma mensagem saía e ninguém ficava sabendo.

Agora:

- **O agente é cobrado uma vez.** Se terminou sem responder, ele recebe a
  instrução de enviar a resposta ou passar a conversa para uma pessoa — e
  dessa vez é obrigado a usar a ferramenta. Na maioria dos casos a resposta já
  estava pronta e sai nessa segunda chance.
- **Se mesmo assim nada sair**, a **Central de avisos** mostra "Um cliente
  ficou sem resposta do agente", com o motivo. Silêncios que são a regra —
  cliente que pediu para parar, conversa passada para uma pessoa — não avisam.
- **Mensagens seguidas do cliente viram uma resposta só, de verdade.** Quem
  escreve três mensagens em sequência não recebe mais duas respostas: cada
  mensagem nova espera um pouco mais, até no máximo 20 segundos desde a
  primeira.
- **Uma falha no resumo do atendimento não refaz mais o atendimento inteiro.**
- **Uma tarefa que falhou espera antes de tentar de novo** (5 s, 10 s, 20 s…),
  em vez de esgotar as tentativas em segundos quando o provedor de IA está
  limitando chamadas.
- **A conferência de promessas não segura mais a fila do número** enquanto
  consulta a IA — antes, todas as conversas daquele número esperavam por ela.

Nada muda para quem opera o servidor: a atualização aplica sozinha a mudança de
banco (um tipo novo de aviso na Central). O teto de espera de mensagens seguidas
pode ser ajustado por `INBOUND_DEBOUNCE_MAX_MS` (opcional, ver `.env.example`).
