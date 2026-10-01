---
impacto: capacidade_nova
secao: adicionado
titulo: O agente responde em áudio pela chave da OpenRouter, sem instalar nada na VPS
---

"Responder em áudio" funcionava só com um serviço de voz instalado na própria
VPS (o Kokoro). Numa VPS de 2 núcleos ele levava ~9 segundos por fala. Com
vários agentes respondendo ao mesmo tempo, as falas passavam do tempo limite e
viravam texto, e o serviço disputava CPU com o WhatsApp.

Agora a voz sai pelo Grok (`x-ai/grok-voice-tts-1.0`), com a chave da
OpenRouter que a organização já cadastrou em **IA › Credenciais**. Nada roda na
VPS, oito falas ao mesmo tempo ficam prontas em cerca de 3 segundos, e cada
organização paga a própria voz (cerca de US$ 0,005 por resposta de 300
caracteres).

Na tela do agente, a escolha de voz mostra as cinco vozes do Grok: Eve
(animada), Ara (calorosa), Rex (profissional), Sal (equilibrada) e Leo (firme).
Sem chave da OpenRouter, a opção fica desligada e a tela diz o que cadastrar.

Quem preferir uma voz sem custo por mensagem ainda pode instalar o Kokoro e
preencher `TTS_BASE_URL`. Preenchido, ele vale para todas as organizações. O
passo a passo, com os números de consumo medidos, está em
`docs/runbooks/voz-do-agente-kokoro.md`.

A imagem do worker passou a incluir o `ffmpeg`, que converte o áudio do Grok
para nota de voz. Nada muda para quem opera o servidor: a atualização traz a
imagem nova sozinha, sem variável nova e sem mudança de banco.
