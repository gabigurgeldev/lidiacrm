---
impacto: capacidade_nova
secao: adicionado
titulo: O agente pode responder em áudio
---

Novo em **Agente de IA › agente › Estilo de resposta**: **Responder em áudio**.
Ligado, cada resposta do agente sai como **nota de voz** no WhatsApp, com a voz
escolhida (Dora, Alex ou Santa). O texto fica guardado na conversa como
transcrição.

A voz é gerada por um modelo aberto que roda na própria VPS, sem custo por
mensagem — o Kokoro, instalado como app separado no Easypanel e apontado em
`TTS_BASE_URL`. Passo a passo em `docs/runbooks/voz-do-agente-kokoro.md`. Sem o
serviço instalado nada muda: o toggle aparece desabilitado com a explicação.

Mensagem com link, e-mail ou longa demais continua em texto. Se o serviço de voz
cair, o cliente recebe a resposta em **texto** — nunca fica sem resposta — e a
Central de avisos mostra que o áudio parou de sair.
