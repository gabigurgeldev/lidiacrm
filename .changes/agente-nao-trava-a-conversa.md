---
impacto: nada_mudou
secao: corrigido
titulo: O agente não trava mais a conversa quando o provedor de IA não responde
---

Medido em produção: uma chamada de IA que o provedor nunca respondia deixava o
atendimento daquele cliente parado por quase uma hora. A resposta já tinha
saído, mas o resumo que vem depois ficou pendurado; a tarefa era reaberta a cada
10 minutos, até desistir na quinta vez — e, como as mensagens de um mesmo
cliente são atendidas em fila, a pergunta seguinte dele só foi respondida 65
minutos depois.

Agora:

- **Toda chamada de IA tem tempo máximo** (turno 2 min, classificadores 20 s,
  resumo 90 s). Estourou, ela é interrompida e aparece em Execuções como
  "tempo esgotado", com a sugestão de um modelo mais rápido.
- **O resumo depois da resposta não segura mais a conversa.** Se falhar, a
  conversa segue; perde-se só o resumo daquele turno.
- **Os dois classificadores rodam ao mesmo tempo** e, se um falhar, o turno
  continua sem ele — antes um esperava o outro, e qualquer falha derrubava a
  resposta inteira.
- **A espera pela vez de enviar, o envio ao provedor e a conversão do áudio
  também têm prazo**, e uma tentativa antiga que "acorda" atrasada não mexe mais
  na tentativa nova.
- **Mensagem nova é vista mais rápido:** o worker ocioso procurava trabalho a
  cada 15 s; agora a cada 3 s.

Nada muda para quem opera o servidor: sem passo de atualização, sem mudança de
banco. Os tempos máximos podem ser ajustados por `LLM_TIMEOUT_MS`,
`LLM_TIMEOUT_CLASSIFICADOR_MS` e `LLM_TIMEOUT_RESUMO_MS` (opcionais, ver
`.env.example`).
