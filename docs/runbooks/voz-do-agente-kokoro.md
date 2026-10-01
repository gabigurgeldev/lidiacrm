# Voz do agente — instalar o Kokoro no Easypanel

O agente pode responder em **nota de voz** (Agente de IA › agente › *Estilo de
resposta* › **Responder em áudio**).

## Antes de instalar: provavelmente você não precisa

**Sem nada instalado, a voz já funciona** pela chave da OpenRouter de cada
organização (IA › Credenciais), com o modelo `x-ai/grok-voice-tts-1.0`. Não roda
nada na VPS, e cada organização paga a própria voz (US$ 15 por milhão de
caracteres, ou ~US$ 0,005 por resposta de 300 caracteres). O mp3 que o Grok
devolve vira nota de voz ogg/opus no worker, com `ffmpeg`. Vozes: Eve, Ara, Rex,
Sal e Leo.

Medido em produção em 2026-10-01, numa VPS de **2 núcleos**:

| | 1 fala | 8 falas ao mesmo tempo (o pico do worker) |
|---|---|---|
| Grok pela OpenRouter | ~1,7s | todas prontas em ~3s |
| Kokoro na VPS | ~9s (~20s a primeira) | ~70s para a última: passa do timeout e vira texto |

Com o Kokoro de pé, a mesma VPS entrou em swap e o WAHA travou: o WhatsApp de
todas as organizações caiu até o WAHA ser reiniciado. **Só instale o Kokoro numa
VPS com folga de CPU e RAM** e se a voz sem custo por mensagem valer isso.
Preenchido, o `TTS_BASE_URL` vale para TODAS as organizações e vence a OpenRouter.

## Kokoro: a voz que roda na sua VPS

O modelo aberto, sem custo por mensagem, é o **Kokoro-82M**, servido pelo
[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) com uma API no
formato da OpenAI (`POST /v1/audio/speech`).

> **⚠️ Um App do Easypanel NÃO é alcançável pelo worker** (medido em
> 2026-10-01): o `worker` do CRM está só nas redes internas do compose, não na
> rede `easypanel` — o override que põe o `app` nela é regravado pelo Easypanel
> a cada implantação. O que funcionou foi um contêiner na rede interna do CRM,
> sem porta publicada:
>
> ```bash
> docker run -d --name lidiacrm_kokoro --network lidiacrm_crm_internal \
>   --network-alias kokoro --restart unless-stopped --memory 2g --cpu-shares 128 \
>   ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0
> ```
>
> com `TTS_BASE_URL=http://kokoro:8880`. `--cpu-shares 128` dá prioridade ao
> WAHA quando os dois disputam CPU. Os passos 1 e 2 abaixo descrevem o caminho
> pelo Easypanel, que só serve se o worker estiver na rede dele.

O serviço **não** faz parte do `docker-compose.prod.yml`: ele pesa ~1–1,5 GB de
RAM, e quem não usa voz não deve pagar isso. Sem ele, o toggle aparece
desabilitado e o agente responde em texto.

## 1. Criar o serviço

No Easypanel, **no mesmo projeto do CRM**:

1. **+ Service › App**, nome `kokoro`.
2. **Source › Docker Image**:

   ```
   ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0
   ```

   Tag **fixa**, nunca `latest` (doutrina de packaging: dependência upstream é
   referenciada com tag fixa e nunca republicada). Ao subir de versão, troque a
   tag aqui e repita o teste do passo 3.
3. **Domains**: nenhum. O serviço só é chamado de dentro da VPS — não publique
   a porta 8880 na internet (qualquer um poderia usar sua CPU).
4. **Resources**: memória 2 GB de teto. A CPU gera o áudio ~1,3–1,8× mais rápido
   que a fala: uma resposta de 10 s leva ~5–7 s para ficar pronta.
5. **Deploy**. A primeira subida baixa o modelo e demora alguns minutos.

## 2. Apontar o CRM para ele

Nas variáveis de ambiente do serviço do CRM (as mesmas que o `app` e o `worker`
leem do `.env`):

```env
TTS_BASE_URL=http://<projeto>_kokoro:8880
# opcionais
TTS_TIMEOUT_MS=30000
TTS_MAX_CHARS=800
```

`<projeto>_kokoro` é o nome interno que o Easypanel dá ao serviço (ex.:
`lidiacrm_kokoro`). Reimplante o CRM para o `app` e o `worker` lerem a variável.

## 3. Provar que o worker alcança o serviço

**Este é o passo que decide.** O CRM roda como serviço *Compose* (rede própria) e
o Kokoro como *App*; confirme que um enxerga o outro antes de ligar o toggle:

```bash
W=$(docker ps --format '{{.Names}}' | grep -m1 worker)
docker exec "$W" wget -qO /tmp/voz.ogg --header 'Content-Type: application/json' \
  --post-data '{"model":"kokoro","input":"Olá, tudo bem?","voice":"pf_dora","response_format":"opus"}' \
  "$TTS_BASE_URL/v1/audio/speech" && docker exec "$W" ls -l /tmp/voz.ogg
```

Saiu um arquivo com alguns KB: pronto. Se der `bad address`/`connection refused`,
as duas redes não se enxergam — **não** contorne publicando a porta 8880 no host
(o Docker fura o firewall do sistema e a porta fica aberta para a internet).
Abra uma issue com a saída do comando.

## 4. Ligar no agente

Agente de IA › agente › **Estilo de resposta** › **Responder em áudio** e escolha
a voz (Dora, Alex ou Santa — vozes do Kokoro para português do Brasil). Publique
a versão.

## Como se comporta

| Situação | O cliente recebe | A Central mostra |
|---|---|---|
| Serviço de pé | nota de voz (o texto fica como transcrição na conversa) | — |
| Mensagem com link ou e-mail | texto (ninguém copia endereço de um áudio) | — |
| Mensagem maior que `TTS_MAX_CHARS` | texto | — |
| Serviço fora / timeout / `TTS_BASE_URL` vazio | **texto** — nunca fica sem resposta | "O agente parou de responder em áudio e está mandando texto" (um aviso aberto por vez) |

O motivo de cada mensagem que caiu para texto fica em
`messages.metadata.voz.fallback`.

**Fora do escopo hoje:** follow-up automático e aviso de escalação continuam em
texto — só a resposta do turno do agente sai em áudio.
