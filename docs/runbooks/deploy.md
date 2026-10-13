# Runbook — Deploy em produção (VPS)

O caminho normal de deploy **não constrói nada na VPS**: o CI publica a imagem no
GHCR e a VPS só puxa. Construir localmente é exceção de emergência, e tem custo —
está documentado no fim.

---

## 1. O comando

```bash
cd /var/www/crm
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

### Os DOIS `-f` são obrigatórios. Sempre.

Esta é a pegadinha que já derrubou o site inteiro em produção (2026-08-05).

A VPS (Hostinger) vem com um **Traefik próprio** ocupando as portas 80/443.
`docker-compose.traefik.yml` é o ÚNICO lugar que:

- coloca no contêiner `app` as labels de roteamento
  (`traefik.http.routers.deskcomm.rule=Host(...)`);
- associa o contêiner à rede que o Traefik enxerga (`TRAEFIK_DOCKER_NETWORK`);
- desliga o `caddy` do compose base por profile (senão dois processos brigam
  pela mesma porta).

Rodar só com `-f docker-compose.prod.yml` recria o contêiner **sem labels
nenhuma**. O Traefik deixa de enxergá-lo e o domínio inteiro passa a responder
`404 page not found` — não é erro do Next, é o 404 genérico do Traefik. A app
está no ar, saudável, e inalcançável.

---

## 2. Verificação pós-deploy (não pule)

`healthy` no `docker ps` **não prova que o site está acessível** — o healthcheck
é um probe TCP interno e passa mesmo com o roteamento quebrado. Verifique as
duas coisas:

```bash
# 1) as labels do Traefik existem?
#    O nome do contêiner é <pasta-do-projeto>-app-1, então pergunte ao compose
#    em vez de chutar. Aqui um -f só basta: o `ps -q` resolve pelo nome do
#    projeto + serviço, não pelo conteúdo do arquivo (medido: com um -f ou com
#    os dois, devolve o MESMO contêiner). Quem precisa dos dois é o `up -d`.
docker inspect "$(docker compose -f docker-compose.prod.yml ps -q app)" \
  --format '{{.Config.Labels}}' | grep -o 'traefik.enable:[^ ]*'
# esperado: traefik.enable:true   (vazio = roteamento quebrado)

# 2) o domínio responde?
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
# esperado: 307 (redireciona pro login)
# 404      = labels perdidas, refaça o deploy com os dois -f
```

---

## 3. Fluxo completo (do código à produção)

```
commit → push → PR → merge na main → CI publica imagem → VPS puxa
```

1. **Commit + push** numa branch de feature. Trabalho que fica só no disco da
   VPS não existe: o CI não o vê, some se a VPS for reconstruída, e é invisível
   pra qualquer outra pessoa.
2. **PR e merge na `main`.** `publish-image.yml` dispara em push na `main` (ou
   tag `v*`) e publica **três** imagens — `deskcommcrm`, `deskcomm-worker` e
   `deskcomm-scheduler` — sempre na mesma versão. O build pesado roda nos
   runners do GitHub, nunca na VPS do usuário.
3. **Deploy na VPS.** Numa instalação real isto é `bash hostgator-setup-kit/update.sh`,
   não um `up -d` na mão: ele puxa a tag publicada, re-aplica o `baseline.sql`,
   faz backup antes e grava as três imagens no `.env`.

> **`latest` não é a última release.** Ele é publicado a partir da branch default, então
> segue o **topo da `main`** — código ainda não lançado. Quem quer a última release usa
> `stable`; quem opera um cliente usa o número da versão. Ver
> [`../doctrine/packaging.md`](../doctrine/packaging.md).

---

## 4. Exceção: imagem construída na VPS

Só quando é preciso validar algo em produção **antes** de a imagem oficial
existir (ex.: CI ainda rodando e um bug bloqueando o usuário).

```bash
APP_IMAGE=deskcomm-app:local docker compose \
  -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env build app

APP_IMAGE=deskcomm-app:local APP_PULL_POLICY=never docker compose \
  -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

O `docker-compose.build.yml` também cobre `worker` e `scheduler` — troque
`app` pelo serviço que você precisa construir. Eles têm `build:` no próprio
compose de produção (é o escape que faz a instalação sobreviver a um registry
fora do ar), mas é o override que traz o `pull_policy: never`; sem ele o
`up -d` volta a buscar a imagem publicada.

**Isto é dívida, não um caminho paralelo.** A imagem existe só no disco daquela
VPS: não está no registry, não está no git, e qualquer `docker compose up -d`
sem `APP_PULL_POLICY=never` a substitui pela do GHCR — silenciosamente, sem erro
nenhum, revertendo o que você acabou de subir.

Requisitos: >= 4 GB de RAM **ou** swap (medido: ~4min num VPS de 3.8 GB com 4 GB
de swap) — e isto é o requisito **deste caminho de exceção**, não da operação
normal. A régua de operação é outra, e não mudou. Ela tem três parcelas, e **duas
são medidas e uma é herdada** — a distinção importa porque a herdada é a que
costuma ser citada como se fosse nossa:

| parcela | estado | como conferir |
|---|---|---|
| 7 contêineres | **medido** | `docker compose -f docker-compose.prod.yml config --services \| wc -l` |
| `mem_limit` somando 2560m (app 768 + worker 512 + waha 1280) | **medido** | `grep -n 'mem_limit' docker-compose.prod.yml` |
| ~150 MB por número de WhatsApp | **herdado do upstream WAHA**, nunca medido neste projeto | `docker stats --no-stream` na sua VPS |

O terceiro número vem de `docs/research/reference-synthesis.md` (síntese do curso
WAHA, 2026-05), não de uma medição nossa — e circula em sete documentos que se
citam entre si. Uma medição pontual na produção do projeto (2026-08-14, **uma**
sessão pareada, VPS compartilhada com outras stacks) deu **304,5 MiB no contêiner
`waha` inteiro**, contra o `mem_limit` de 1280 MiB. Um ponto não decompõe baseline
e sessão: para isso seriam necessários dois números pareados, e não é ensaio que
se faça numa instalação viva.

**Nada disso mexe no tier recomendado.** A régua que sustenta os 4 GB é a soma da
stack em operação, não o WAHA isolado — e a folga existe justamente porque a
parcela por sessão não é conhecida com precisão.

Ao terminar, feche o ciclo — merge na `main` e volte a VPS pra imagem oficial.


---

## 5. Vigia da produção (watchdog)

Existe para o incidente de **2026-10-13**: a VPS reiniciou, o `kong` (gateway do
Supabase) subiu amarrado a uma rede que o boot recriou (`network <id> not found`,
`Exited (255)`) e **ficou parado por 2 h 10**. O `restart: unless-stopped` não
salva esse caso — o Docker desiste da partida. Resultado: `supabase.<domínio>`
respondendo 502, o CRM sem login, e ninguém avisado.

`scripts/vps/lidiacrm-watchdog.sh` roda **no host**, a cada minuto, via systemd
timer, e faz duas coisas:

1. **Cura.** Contêiner de projeto Compose parado por falha de partida (tem
   `State.Error`, ou saiu com 255) volta com `docker start`; se isso falhar, é
   recriado com `docker compose up -d --no-deps <serviço>` usando os `-f` que o
   próprio Compose gravou nas labels do contêiner. Parada deliberada
   (`docker stop`: exit 0/137/143, sem erro) **não é tocada**. No máximo uma
   tentativa a cada 5 min por contêiner, e nada nos 3 min seguintes ao boot (o
   Docker ainda está subindo tudo).
2. **Avisa.** Sonda `/api/v1/health` e, depois de `LIMITE` falhas seguidas
   (padrão 3, ≈3 min), manda e-mail com o corpo do health, os contêineres
   parados e a memória. Reavisa a cada hora enquanto seguir fora e manda um
   segundo e-mail quando volta. O envio usa o SMTP do próprio app, lido do `.env`
   dele na hora — nenhum segredo é copiado para o vigia. Por viver no host, o
   aviso sai **mesmo com o Supabase ou o app fora**, que é exatamente quando
   um alerta feito dentro do app não existiria.

### Instalar (uma vez por VPS, como root)

```bash
install -m 755 scripts/vps/lidiacrm-watchdog.sh /usr/local/sbin/lidiacrm-watchdog

cat > /etc/lidiacrm-watchdog.env <<'EOF'
HEALTH_URL="https://SEU-DOMINIO/api/v1/health"
ALERTA_PARA="voce@exemplo.com"
# PROJETOS="lidiacrm_supabase lidiacrm_crm"   # nomes de projeto do Compose a vigiar
# ENV_APP="/caminho/do/.env/do/app"           # de onde sai o EMAIL_SMTP_*
EOF

cat > /etc/systemd/system/lidiacrm-watchdog.service <<'EOF'
[Unit]
Description=Vigia da producao do CRM (cura conteiner e sonda saude)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lidiacrm-watchdog
TimeoutStartSec=120
EOF

cat > /etc/systemd/system/lidiacrm-watchdog.timer <<'EOF'
[Unit]
Description=Roda o vigia da producao a cada minuto

[Timer]
OnBootSec=3min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload && systemctl enable --now lidiacrm-watchdog.timer
/usr/local/sbin/lidiacrm-watchdog --testar-email   # manda 1 e-mail de teste
```

Sem `HEALTH_URL` a sonda fica desligada; sem `ALERTA_PARA` o aviso vira só linha
no log. O log é `/var/log/lidiacrm-watchdog.log` (e `journalctl -t lidiacrm-watchdog`).
Estado em `/var/lib/lidiacrm-watchdog/`.

### Reentrega do webhook do WAHA

O WAHA reentrega webhook que falhou, e o padrão dele desiste em ~1 min (15
tentativas × 2 s). Na mesma queda de 2026-10-13, **676 de 679 webhooks**
esgotaram as tentativas — 212 eram mensagens (`message.any`) que nunca chegaram ao
CRM. Sem o NOWEB store ligado o WAHA não guarda histórico, então a mensagem não
volta por API: a única cópia fica no celular do cliente.

`docker-compose.prod.yml` agora põe `WHATSAPP_HOOK_RETRIES_*` em exponencial
(base 5 s, 11 tentativas ≈ 5,7 h de cobertura). Os três botões
(`WAHA_HOOK_RETRIES_POLICY`, `WAHA_HOOK_RETRIES_DELAY_SECONDS`,
`WAHA_HOOK_RETRIES_ATTEMPTS`) têm default no compose: `.env` antigo não precisa de
edição. A mudança só vale depois de recriar o `waha`, o que derruba as sessões por
~30 s (voltam sozinhas):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d waha
docker exec <contêiner-waha> printenv | grep HOOK_RETRIES   # confira os três
```
