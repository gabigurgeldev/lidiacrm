#!/usr/bin/env bash
# lidiacrm-watchdog — vigia da produção (VPS EasyPanel). Roda a cada minuto via
# systemd timer (lidiacrm-watchdog.timer). Duas obrigações:
#
#  1. CURAR: sobe contêiner Compose que morreu na PARTIDA — o caso do kong depois
#     de um reboot ("network <id> not found", Exited 255), que o
#     `restart: unless-stopped` não resolve. Parada deliberada (docker stop: exit
#     0/137/143, sem State.Error) NÃO é tocada.
#  2. AVISAR: sonda /api/v1/health e manda e-mail (SMTP/SES do próprio app) quando
#     fica fora por LIMITE sondagens seguidas, e de novo quando volta.
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

[ -r /etc/lidiacrm-watchdog.env ] && . /etc/lidiacrm-watchdog.env
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
    echo 0 > "$ESTADO/falhas"; rm -f "$corpo"; return 0
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

if [ "${1:-}" = "--testar-email" ]; then
  enviar_email "[Gestalt CRM] Teste do alerta de produção" \
"Este é um teste. O watchdog da VPS vai avisar neste endereço quando a produção cair ($HEALTH_URL) e quando voltar.
Horário (UTC): $(date -u +%FT%TZ)"
  exit $?
fi

curar
sondar
