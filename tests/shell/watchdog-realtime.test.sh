#!/usr/bin/env bash
# Gate do bloco "tempo real" do scripts/vps/lidiacrm-watchdog.sh.
#
# Em 2026-10-20 o Realtime da produção ficou fora por horas (631/631 websockets
# com 503) e ninguém foi avisado: o health respondia 200, e o vigia só olhava o
# código HTTP. O check `realtime` do health é `degraded` de propósito — o
# atendimento segue —, então o vigia precisa lê-lo pelo nome. O que este teste
# guarda:
#
# 1. AVISA DEPOIS DE LIMITE FALHAS, NÃO ANTES: uma sondagem ruim é ruído.
# 2. O ASSUNTO É O CERTO: "Tempo real fora", nunca "PRODUÇÃO FORA DO AR" — o
#    CRM está atendendo, e alarme falso ensina a ignorar alarme.
# 3. AVISA A VOLTA, e zera o contador.
# 4. NÃO JULGA O QUE NÃO VÊ: health sem o check (imagem anterior) não gera
#    linha nenhuma; health fora (503) é assunto da sonda principal.
#
# Nada aqui fala com rede ou Docker: curl, docker, flock e logger são dublês.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

VIGIA="scripts/vps/lidiacrm-watchdog.sh"
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check() {
  local nome="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ✓ %s\n' "$nome"
  else printf '  ✗ %s\n' "$nome"; fail=1; fi
}

mkdir -p "$TMP/bin" "$TMP/estado"
# curl dublado: escreve $TMP/corpo no arquivo de -o e imprime $TMP/codigo.
cat > "$TMP/bin/curl" <<EOF
#!/usr/bin/env bash
out=""; while [ \$# -gt 0 ]; do [ "\$1" = "-o" ] && { out="\$2"; shift; }; shift; done
[ -n "\$out" ] && cp "$TMP/corpo" "\$out"
cat "$TMP/codigo"
EOF
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/docker"
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/flock"
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/logger"
chmod +x "$TMP/bin/"*

cat > "$TMP/conf" <<EOF
HEALTH_URL="https://crm.exemplo.test/api/v1/health"
ALERTA_PARA=""
LIMITE=3
ESTADO="$TMP/estado"
LOG="$TMP/log"
PROJETOS="nenhum"
EOF

rodar() { # $1 código HTTP  $2 corpo
  printf '%s' "$1" > "$TMP/codigo"; printf '%s' "$2" > "$TMP/corpo"
  PATH="$TMP/bin:$PATH" LIDIACRM_WATCHDOG_ENV="$TMP/conf" bash "$VIGIA"
}
linhas() { grep -c "$1" "$TMP/log" 2>/dev/null || true; }

FORA='{"data":{"status":"degraded","checks":{"supabase":{"status":"ok","latency_ms":5},"realtime":{"status":"degraded","latency_ms":9,"error":"http_503","reason":"resposta_inesperada"},"redis":{"status":"ok","latency_ms":3}}}}'
OK='{"data":{"status":"healthy","checks":{"supabase":{"status":"ok","latency_ms":5},"realtime":{"status":"ok","latency_ms":9},"redis":{"status":"ok","latency_ms":3}}}}'
ANTIGO='{"data":{"status":"healthy","checks":{"supabase":{"status":"ok","latency_ms":5}}}}'

echo "watchdog — tempo real"

rodar 200 "$FORA"; rodar 200 "$FORA"
check "duas falhas: conta, não avisa" test "$(linhas 'Tempo real fora')" = 0
check "duas falhas: contador em 2" test "$(cat "$TMP/estado/rt_falhas")" = 2
rodar 200 "$FORA"
check "terceira falha: avisa" test "$(linhas 'Tempo real fora')" = 1
check "o aviso NÃO diz que a produção caiu" test "$(linhas 'PRODUÇÃO FORA DO AR')" = 0
check "a linha de falha leva o detalhe do check" grep -q 'realtime: FALHA #3 .*http_503' "$TMP/log"
rodar 200 "$FORA"
check "quarta falha dentro da hora: não reavisa" test "$(linhas 'Tempo real fora')" = 1

rodar 200 "$OK"
check "volta: avisa a recuperação" test "$(linhas 'Tempo real recuperado')" = 1
check "volta: zera o contador" test "$(cat "$TMP/estado/rt_falhas")" = 0
rodar 200 "$OK"
check "segunda sondagem ok: não repete a recuperação" test "$(linhas 'Tempo real recuperado')" = 1

antes=$(linhas 'realtime:')
rodar 200 "$ANTIGO"
check "health sem o check: nada a julgar" test "$(linhas 'realtime:')" = "$antes"

rodar 200 "$FORA"
rodar 503 "$FORA"
check "health 503: é da sonda principal, o tempo real não conta" test "$(cat "$TMP/estado/rt_falhas")" = 1
check "health 503: a sonda principal registrou" grep -q 'saude: FALHA #1 (http 503)' "$TMP/log"

exit $fail
