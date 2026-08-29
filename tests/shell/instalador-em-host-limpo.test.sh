#!/usr/bin/env bash
# Gate da PRIMEIRA instalação de um host — a única que todo self-hoster faz, e a
# que nenhum teste do kit exercitava. Os dois defeitos abaixo foram medidos
# instalando a v1.10.1 numa VPS Ubuntu 24.04 limpa (Docker 29.7.1), e nenhum dos
# dois aparece numa segunda execução: o host já não está mais limpo.
#
# 1. CRASE DENTRO DO HEREDOC QUE CRIA O DONO. O `<<SQL` do install.sh não é
#    citado — de propósito, porque o SQL interpola `${OWNER_EMAIL}` e
#    `${APP_LOCALE}`. Então o bash também expande CRASE ali dentro, inclusive
#    dentro de um comentário `--`. Um comentário que dizia `` -- `locale` aqui ``
#    executava o comando `locale` e colava a saída dele no meio do SQL; a segunda
#    linha dessa saída é `LANGUAGE=`, sem o `--` na frente, e o psql morria com
#    `"language" is not a known variable`. A criação do dono não acontecia, e o
#    instalador caía no banner que manda apagar o `.env` e recomeçar.
#
#    O install.sh já avisava sobre isso — em prosa, num comentário 30 linhas
#    abaixo, falando só de "nome de coluna". A prosa não impediu a reincidência,
#    e é por isso que este teste existe: ele proíbe CRASE, qualquer crase, em
#    todo o corpo do heredoc.
#
# 2. `crontab -l` NUM HOST SEM CRONTAB. Sai 1, e sob `set -euo pipefail` esse 1
#    vira o status do pipeline inteiro — inclusive do `( ... ) | crontab -` em
#    que o `crontab -` que escreveu a linha devolveu 0. O instalador morria
#    DEPOIS de gravar o cron do drain e ANTES do agente de atualização, sem
#    mensagem (o `2>/dev/null` come a única pista). Aqui o `crontab` é dublado
#    para reproduzir exatamente esse host.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

KIT="hostgator-setup-kit"
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check() {
  local nome="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ✓ %s\n' "$nome"
  else printf '  ✗ %s\n' "$nome"; fail=1; fi
}

# ── 1. O heredoc do bootstrap do dono não pode conter crase ──────────────────
echo "install.sh: o heredoc que cria o dono não tem substituição de comando"

# Recorta o corpo entre a linha que ABRE o heredoc (`<<SQL`) e o terminador
# (`SQL` sozinho na linha). Recortar em vez de varrer o arquivo inteiro é o que
# dá o alvo certo: crase em qualquer outro ponto do script é legítima.
CORPO="$TMP/heredoc.sql"
awk '/<<SQL/{dentro=1; next} dentro && /^SQL$/{dentro=0} dentro' "$KIT/install.sh" > "$CORPO"

check "o heredoc foi localizado (recorte não é vazio)" test -s "$CORPO"
check "o recorte é mesmo o SQL do dono" grep -q "insert into public.platform_admins" "$CORPO"

CRASES="$(grep -c '`' "$CORPO" || true)"
if [ "${CRASES:-0}" -eq 0 ]; then
  printf '  ✓ %s\n' "nenhuma crase no corpo do heredoc"
else
  printf '  ✗ %s\n' "há $CRASES linha(s) com crase — o bash vai EXECUTAR o conteúdo:"
  grep -n '`' "$CORPO" | sed 's/^/      /'
  fail=1
fi

# Controle positivo: o teste acima só vale se ele REPROVA uma crase de verdade.
# Sem isto, um `awk` que devolvesse vazio passaria como "nenhuma crase".
printf -- '-- `locale` aqui\n' > "$TMP/sujo.sql"
check "o gate reprova uma crase injetada (controle positivo)" \
  sh -c "grep -q '\`' '$TMP/sujo.sql'"

# E a prova do MECANISMO, não só da presença: um heredoc não citado com esse
# comentário realmente executa o comando e injeta a saída.
INJETADO="$(bash -c 'cat <<SQL
-- `printf CANARIO`
SQL')"
check "heredoc não citado de fato executa a crase (mecanismo provado)" \
  sh -c "printf '%s' \"\$0\" | grep -q CANARIO" "$INJETADO"

# ── 2. Os crons instalam num host que ainda não tem crontab ──────────────────
echo
echo "_common.sh: os crons instalam num host SEM crontab prévio"

mkdir -p "$TMP/bin"
CRONTAB_FALSO="$TMP/crontab.txt"   # começa INEXISTENTE: é o host limpo

# Dublê fiel ao vixie-cron do Ubuntu em DOIS pontos, e o segundo custou uma
# falha falsa até ser entendido:
#
#   `-l` sem crontab → mensagem em stderr e exit 1. É o defeito sob teste.
#
#   `-` escreve num TEMPORÁRIO e renomeia. Os dois lados de `( crontab -l | ...
#   ) | crontab -` rodam ao mesmo tempo; um dublê que fizesse `cat > "$alvo"`
#   truncaria o arquivo enquanto o `crontab -l` do outro lado ainda o lê, e a
#   linha da chamada ANTERIOR sumiria. Isso é corrida do dublê, não do produto:
#   o crontab real nunca escreve em cima do arquivo que está sendo lido.
#   (Conferido na VPS: depois do install.sh as duas linhas coexistem.)
cat > "$TMP/bin/crontab" <<'STUB'
#!/bin/sh
alvo="${CRONTAB_FALSO:?}"
case "${1:-}" in
  -l) [ -f "$alvo" ] || { echo "no crontab for $(id -un)" >&2; exit 1; }; cat "$alvo";;
  -)  tmp="$alvo.$$"; cat > "$tmp"; mv "$tmp" "$alvo";;
  *)  exit 2;;
esac
STUB
chmod +x "$TMP/bin/crontab"

# `docker` dublado: o drain chama psql_run na primeira ativação. Ele já está
# protegido por `|| c_ylw`, mas sem o dublê o teste dependeria de um daemon.
printf '#!/bin/sh\nexit 1\n' > "$TMP/bin/docker"
chmod +x "$TMP/bin/docker"

SAIDA="$TMP/saida.txt"
env PATH="$TMP/bin:$PATH" CRONTAB_FALSO="$CRONTAB_FALSO" \
    PROJECT_DIR="/root/deskcommcrm" \
    INTERNAL_SECRET="segredo-de-teste" \
    NEXT_PUBLIC_APP_URL="https://exemplo.com.br" \
  bash -c '
    set -euo pipefail
    . hostgator-setup-kit/_common.sh
    setup_event_log_drain_cron
    setup_update_agent_cron
  ' > "$SAIDA" 2>&1
RC=$?

check "as duas funções terminam com sucesso (exit 0)" test "$RC" -eq 0
check "o cron do drain foi gravado" \
  grep -q "api/v1/cron/event-log-drain" "$CRONTAB_FALSO"
check "o cron do agente de atualização foi gravado" \
  grep -q "hostgator-setup-kit/agent.sh" "$CRONTAB_FALSO"
# É este o ✓ que sumia: a morte acontecia entre gravar a linha e anunciá-la.
check "o drain ANUNCIOU que ativou (o ✓ que faltava)" \
  grep -q "automações ativas" "$SAIDA"
check "o agente ANUNCIOU que ativou" \
  grep -q "atualização pela tela ativa" "$SAIDA"

if [ "$RC" -ne 0 ]; then
  echo "  --- saída da execução (rc=$RC) ---"
  sed 's/^/      /' "$SAIDA"
fi

# Re-execução (host que JÁ tem crontab): idempotente, sem duplicar linha. É o
# caminho que funcionava antes e que o conserto não pode ter quebrado.
env PATH="$TMP/bin:$PATH" CRONTAB_FALSO="$CRONTAB_FALSO" \
    PROJECT_DIR="/root/deskcommcrm" \
    INTERNAL_SECRET="segredo-de-teste" \
    NEXT_PUBLIC_APP_URL="https://exemplo.com.br" \
  bash -c '
    set -euo pipefail
    . hostgator-setup-kit/_common.sh
    setup_event_log_drain_cron
    setup_update_agent_cron
  ' >/dev/null 2>&1
RC2=$?
check "re-execução também sai 0 (idempotente)" test "$RC2" -eq 0
N_DRAIN="$(grep -c "api/v1/cron/event-log-drain" "$CRONTAB_FALSO" || true)"
N_AGENT="$(grep -c "hostgator-setup-kit/agent.sh" "$CRONTAB_FALSO" || true)"
check "o drain não duplicou (1 linha)"  test "$N_DRAIN" -eq 1
check "o agente não duplicou (1 linha)" test "$N_AGENT" -eq 1

echo
if [ "$fail" -eq 0 ]; then
  echo "instalador-em-host-limpo: OK"
else
  echo "instalador-em-host-limpo: FALHOU"
fi
exit "$fail"
