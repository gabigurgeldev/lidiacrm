#!/usr/bin/env bash
# lidiacrm-watchdog — vigia da produção (VPS EasyPanel). Roda a cada minuto via
# systemd timer (lidiacrm-watchdog.timer). Três obrigações:
#
#  1. CURAR: sobe contêiner Compose que morreu na PARTIDA — o caso do kong depois
#     de um reboot ("network <id> not found", Exited 255), que o
#     `restart: unless-stopped` não resolve. Parada deliberada (docker stop: exit
#     0/137/143, sem State.Error) NÃO é tocada.
#     Também recria serviço que SUMIU (sem contêiner nenhum) enquanto o resto do
#     projeto segue de pé — incidente de 2026-10-16: depois de 2 h falhando no
#     attach da overlay `easypanel`, o contêiner do kong desapareceu e o vigia,
#     que só olhava contêiner parado, ficou 11 h sem ter o que curar. Projeto
#     inteiro sem contêiner (`compose down` pelo painel) é deliberado e é pulado.
#  2. AVISAR: sonda /api/v1/health e manda e-mail (SMTP/SES do próprio app) quando
#     fica fora por LIMITE sondagens seguidas, e de novo quando volta.
#  3. TEMPO REAL: o check `realtime` do health é `degraded` (a rota segue 200),
#     então a sonda do item 2 não o vê; ele tem contador e e-mail próprios.
#
# Configuração em /etc/lidiacrm-watchdog.env (HEALTH_URL é obrigatório; ALERTA_PARA,
# LIMITE, LEMBRETE_MIN, PROJETOS e ENV_APP são opcionais). Instalação em
# docs/runbooks/deploy.md, seção "Vigia da produção". Nenhum segredo mora neste
# arquivo: as credenciais SMTP são lidas do .env do app no momento do envio.
set -u

ALERTA_PARA=""        # destinatário do e-mail de alerta; vazio = só log
HEALTH_URL=""         # ex.: https://SEU-DOMINIO/api/v1/health (obrigatório, vem do /etc/lidiacrm-watchdog.env)
LIMITE=3          # sondagens seguidas com falha (~3 min) antes de avisar
LEMBRETE_MIN=60   # reaviso enquanto seguir fora
PROJETOS="lidiacrm_supabase lidiacrm_crm"
ENV_APP="/etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel/.env"
ESTADO="/var/lib/lidiacrm-watchdog"
LOG="/var/log/lidiacrm-watchdog.log"

CONF="${LIDIACRM_WATCHDOG_ENV:-/etc/lidiacrm-watchdog.env}"   # outro caminho só no teste (tests/shell)
[ -r "$CONF" ] && . "$CONF"
mkdir -p "$ESTADO"

exec 9>"$ESTADO/lock"
flock -n 9 || exit 0

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; logger -t lidiacrm-watchdog -- "$*"; }
agora() { date +%s; }

# ── e-mail ────────────────────────────────────────────────────────────────────
env_app() { grep -m1 "^$1=" "$ENV_APP" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

enviar_email() { # $1 assunto  $2 corpo
  if [ -z "$ALERTA_PARA" ]; then log "email: ALERTA_PARA vazio — so log: $1"; return 0; fi
  local host port user pass from addr url msg
  host=$(env_app EMAIL_SMTP_HOST); port=$(env_app EMAIL_SMTP_PORT); port=${port:-587}
  user=$(env_app EMAIL_SMTP_USER); pass=$(env_app EMAIL_SMTP_PASS); from=$(env_app EMAIL_FROM)
  if [ -z "$host" ] || [ -z "$user" ] || [ -z "$pass" ]; then log "email: SMTP ausente em $ENV_APP — alerta nao enviado"; return 1; fi
  addr=$(printf '%s' "$from" | sed -n 's/.*<\(.*\)>.*/\1/p'); addr=${addr:-$from}
  if [ "$port" = 465 ]; then url="smtps://$host:$port"; else url="smtp://$host:$port"; fi
  msg=$(mktemp)
  {
    printf 'From: %s\r\nTo: %s\r\n' "${from:-$addr}" "$ALERTA_PARA"
    printf 'Subject: =?UTF-8?B?%s?=\r\n' "$(printf '%s' "$1" | base64 -w0)"
    printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'
    printf '%s\n' "$2" | base64
  } > "$msg"
  # credencial via stdin (-K -): nao aparece em `ps`
  printf 'user = "%s:%s"\n' "$user" "$pass" | curl -sS -m 40 --ssl-reqd "$url" \
    --mail-from "$addr" --mail-rcpt "$ALERTA_PARA" -T "$msg" -K - >> "$LOG" 2>&1
  local rc=$?; rm -f "$msg"
  [ $rc -eq 0 ] && log "email enviado: $1" || log "email FALHOU (curl rc=$rc): $1"
  return $rc
}

# ── 1. curar ──────────────────────────────────────────────────────────────────
curar() {
  # logo apos o boot o proprio Docker ainda esta subindo os contêineres
  [ "$(cut -d. -f1 /proc/uptime)" -lt 180 ] && return 0
  local p c pol code err svc wd cfg args last
  for p in $PROJETOS; do
    for c in $(docker ps -a --filter "label=com.docker.compose.project=$p" --filter status=exited --filter status=created --format '{{.Names}}'); do
      pol=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c")
      [ "$pol" = unless-stopped ] || [ "$pol" = always ] || continue
      code=$(docker inspect -f '{{.State.ExitCode}}' "$c"); err=$(docker inspect -f '{{.State.Error}}' "$c")
      if [ -z "$err" ] && [ "$code" != 255 ]; then continue; fi
      last=$(cat "$ESTADO/curou.$c" 2>/dev/null || echo 0)
      [ $(( $(agora) - last )) -lt 300 ] && continue   # no maximo 1 tentativa / 5 min por contêiner
      agora > "$ESTADO/curou.$c"
      log "curar: $c parado (exit=$code err='$err') — docker start"
      if docker start "$c" >/dev/null 2>&1; then log "curar: $c subiu com docker start"; continue; fi
      svc=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c")
      wd=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c")
      cfg=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$c")
      args=(); for f in ${cfg//,/ }; do args+=(-f "$f"); done
      log "curar: $c — docker start falhou, recriando '$svc' (compose up --no-deps)"
      if docker compose -p "$p" --project-directory "$wd" "${args[@]}" up -d --no-deps "$svc" >> "$LOG" 2>&1; then
        log "curar: $svc recriado"
      else
        log "curar: $svc FALHOU ao recriar"
      fi
    done
  done
  curar_ausentes
}

# serviço declarado com restart unless-stopped/always e SEM contêiner, num projeto
# que tem outros contêineres rodando. `migrate` (restart: no) nunca entra.
curar_ausentes() {
  local p ref wd cfg args f svc tem last
  for p in $PROJETOS; do
    ref=$(docker ps --filter "label=com.docker.compose.project=$p" --format '{{.Names}}' | head -1)
    [ -n "$ref" ] || continue   # nada rodando: projeto parado de propósito
    wd=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$ref")
    cfg=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$ref")
    args=(); for f in ${cfg//,/ }; do args+=(-f "$f"); done
    tem=" $(docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Label "com.docker.compose.service"}}' | sort -u | xargs) "
    for svc in $(docker compose -p "$p" --project-directory "$wd" "${args[@]}" config --format json 2>/dev/null \
                 | jq -r '.services|to_entries[]|select(.value.restart=="unless-stopped" or .value.restart=="always")|.key'); do
      case "$tem" in *" $svc "*) continue ;; esac
      last=$(cat "$ESTADO/curou.$p.$svc" 2>/dev/null || echo 0)
      [ $(( $(agora) - last )) -lt 300 ] && continue
      agora > "$ESTADO/curou.$p.$svc"
      log "curar: $p/$svc sem conteiner — recriando (compose up --no-deps)"
      if docker compose -p "$p" --project-directory "$wd" "${args[@]}" up -d --no-deps "$svc" >> "$LOG" 2>&1; then
        log "curar: $p/$svc recriado"
      else
        log "curar: $p/$svc FALHOU ao recriar"
      fi
    done
  done
}

# ── 2. sondar e avisar ────────────────────────────────────────────────────────
sondar() {
  if [ -z "$HEALTH_URL" ]; then log "saude: HEALTH_URL vazio em /etc/lidiacrm-watchdog.env — sonda desligada"; return 0; fi
  local code corpo falhas alertado_em
  corpo=$(mktemp)
  code=$(curl -s -m 20 -o "$corpo" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null); code=${code:-000}
  falhas=$(cat "$ESTADO/falhas" 2>/dev/null || echo 0)

  if [ "$code" = 200 ]; then
    if [ -f "$ESTADO/alertado_em" ]; then
      log "saude: recuperou (http 200) apos $falhas sondagens falhas"
      enviar_email "[Gestalt CRM] Produção recuperada" \
"A produção voltou a responder.

$HEALTH_URL => HTTP 200
$(head -c 800 "$corpo")

Sondagens falhas seguidas antes de voltar: $falhas
Horário (UTC): $(date -u +%FT%TZ)"
      rm -f "$ESTADO/alertado_em"
    fi
    echo 0 > "$ESTADO/falhas"
    sondar_realtime "$corpo"
    rm -f "$corpo"; return 0
  fi

  falhas=$((falhas + 1)); echo "$falhas" > "$ESTADO/falhas"
  log "saude: FALHA #$falhas (http $code)"
  if [ "$falhas" -ge "$LIMITE" ]; then
    alertado_em=$(cat "$ESTADO/alertado_em" 2>/dev/null || echo 0)
    if [ "$alertado_em" = 0 ] || [ $(( $(agora) - alertado_em )) -ge $(( LEMBRETE_MIN * 60 )) ]; then
      enviar_email "[Gestalt CRM] PRODUÇÃO FORA DO AR (HTTP $code)" \
"A sonda de saúde falhou $falhas vezes seguidas.

$HEALTH_URL => HTTP $code
$(head -c 800 "$corpo")

Contêineres parados no host:
$(docker ps -a --filter status=exited --filter status=created --format '  {{.Names}}  {{.Status}}' | grep -E 'lidiacrm_' || echo '  (nenhum do projeto lidiacrm)')

Memória: $(free -m | awk '/Mem:/ {print $3 "/" $2 " MB"}')   Uptime: $(uptime -p)
Horário (UTC): $(date -u +%FT%TZ)

O watchdog já tenta subir contêiner que morreu na partida. Log: $LOG"
      agora > "$ESTADO/alertado_em"
    fi
  fi
  rm -f "$corpo"
}

# ── 3. tempo real ─────────────────────────────────────────────────────────────
# O health responde 200 com o Realtime fora (é `degraded`: atendimento segue, só
# as telas param de atualizar ao vivo). Por isso a sonda acima não vê, e este
# bloco lê o check pelo nome. Incidente de 2026-10-20: 631/631 websockets com
# 503 por horas, health "healthy", ninguém avisado. Contador e aviso próprios —
# o assunto do e-mail não pode dizer "fora do ar" de um CRM que está atendendo.
sondar_realtime() { # $1 corpo do health que respondeu 200
  local st detalhe falhas alertado_em
  st=$(grep -o '"realtime":{"status":"[a-z]*"' "$1" | sed 's/.*"status":"//; s/"$//')
  [ -n "$st" ] || return 0   # imagem anterior ao check: nada a julgar
  falhas=$(cat "$ESTADO/rt_falhas" 2>/dev/null || echo 0)

  if [ "$st" = ok ]; then
    if [ -f "$ESTADO/rt_alertado_em" ]; then
      log "realtime: recuperou apos $falhas sondagens falhas"
      enviar_email "[Gestalt CRM] Tempo real recuperado" \
"As telas do CRM voltaram a atualizar ao vivo.

Sondagens falhas seguidas antes de voltar: $falhas
Horário (UTC): $(date -u +%FT%TZ)"
      rm -f "$ESTADO/rt_alertado_em"
    fi
    echo 0 > "$ESTADO/rt_falhas"; return 0
  fi

  detalhe=$(grep -o '"realtime":{[^}]*}' "$1")
  falhas=$((falhas + 1)); echo "$falhas" > "$ESTADO/rt_falhas"
  log "realtime: FALHA #$falhas ($detalhe)"
  [ "$falhas" -ge "$LIMITE" ] || return 0
  alertado_em=$(cat "$ESTADO/rt_alertado_em" 2>/dev/null || echo 0)
  if [ "$alertado_em" = 0 ] || [ $(( $(agora) - alertado_em )) -ge $(( LEMBRETE_MIN * 60 )) ]; then
    enviar_email "[Gestalt CRM] Tempo real fora — telas não atualizam sozinhas" \
"O CRM está no ar e atendendo, mas o Realtime do Supabase não responde:
Inbox e telas só mostram novidade recarregando a página.

$HEALTH_URL => $detalhe
Sondagens falhas seguidas: $falhas

Causa já vista (2026-10-20): o Kong não resolve realtime-dev.supabase-realtime,
porque o compose do EasyPanel tirou o container_name do serviço realtime.
Confira com:
  docker exec lidiacrm_supabase-kong-1 getent hosts realtime-dev.supabase-realtime
Conserto em docs/runbooks/deploy.md, seção \"Realtime fora\".

Horário (UTC): $(date -u +%FT%TZ)"
    agora > "$ESTADO/rt_alertado_em"
  fi
}

if [ "${1:-}" = "--testar-email" ]; then
  enviar_email "[Gestalt CRM] Teste do alerta de produção" \
"Este é um teste. O watchdog da VPS vai avisar neste endereço quando a produção cair ($HEALTH_URL) e quando voltar.
Horário (UTC): $(date -u +%FT%TZ)"
  exit $?
fi

curar
sondar
