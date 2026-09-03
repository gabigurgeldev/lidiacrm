# Aplica supabase/baseline.sql num banco existente -- o que o update.sh do kit
# faz na VPS, para quem implanta por um caminho que NAO roda aquele script
# (EasyPanel, Coolify, Dokploy: eles puxam a imagem e nada mais).
#
# --- Por que este arquivo existe -------------------------------------------
#
# A cadeia "merge -> publish-image -> deploy-vps" entrega CODIGO novo e deixa o
# SCHEMA para tras: nenhum passo dela toca no banco. Toda mudanca de schema fica
# pendente sem aviso ate alguma tela reclamar -- e a maioria das telas nao
# reclama, ela so devolve menos dado.
#
# Isto e um remendo COM DATA PARA SAIR. O conserto de verdade e a cadeia aplicar
# o schema sozinha; enquanto ele nao vem, este e o passo manual, escrito para
# nao depender de memoria.
#
# --- Uso -------------------------------------------------------------------
#
#   $env:SUPABASE_DB_URL = "postgresql://postgres:SENHA@host:5432/postgres"
#   .\scripts\aplicar-baseline-em-producao.ps1
#
# A URL vem de VARIAVEL e nao de parametro: parametro fica no historico do
# shell, e essa string contem a senha do banco.
#
# --- Quatro armadilhas de PowerShell que este arquivo evita de proposito ----
#
# 1. SEM "2>&1" em executavel nativo. No PowerShell 5.1 isso embrulha CADA linha
#    de stderr num ErrorRecord (NativeCommandError) e, com ErrorActionPreference
#    em Stop, o script MORRE na primeira mensagem informativa. Medido aqui: o
#    "Unable to find image 'postgres:17-alpine' locally" -- que e o docker
#    avisando que vai BAIXAR -- abortava tudo. Quem precisa do stderr usa
#    Start-Process com -RedirectStandardError, que nao passa por esse wrapper.
# 2. SEM redirecionamento "<": o PowerShell reserva esse operador e recusa a
#    linha inteira. O arquivo entra por -v + -f, nunca por stdin.
# 3. SEM backtick de continuacao junto com aspas escapadas: a combinacao quebra
#    o parser em cascata, e o erro aponta para a linha errada.
# 4. SEM caminho com espaco/acento chegando ao docker: o binario e nativo do
#    Windows e a montagem -v se parte no meio. O baseline e COPIADO para o TEMP
#    (caminho limpo) antes de ser montado.

$ErrorActionPreference = "Stop"

$IMAGEM = "postgres:17-alpine"

$url = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($url)) {
  Write-Host "FALTA a variavel SUPABASE_DB_URL." -ForegroundColor Red
  Write-Host "Defina antes de rodar:" -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_DB_URL = "postgresql://postgres:SENHA@host:5432/postgres"'
  exit 1
}

$raiz = Split-Path $PSScriptRoot -Parent
$baseline = Join-Path $raiz "supabase\baseline.sql"
if (-not (Test-Path $baseline)) {
  Write-Host "nao achei $baseline" -ForegroundColor Red
  exit 1
}

# Roda o docker capturando saida e erro em ARQUIVOS, via Start-Process.
#
# Existe por causa da armadilha 1: e o unico jeito de ter o stderr do psql (onde
# os erros de SQL saem) sem que o PowerShell transforme cada linha num
# ErrorRecord e derrube o script antes de comecar.
function Invoke-Docker {
  param([string[]]$Argumentos, [string]$SaidaEm, [string]$ErroEm)

  $p = Start-Process -FilePath "docker" -ArgumentList $Argumentos -NoNewWindow -Wait -PassThru `
       -RedirectStandardOutput $SaidaEm -RedirectStandardError $ErroEm
  return $p.ExitCode
}

$tmpOut = Join-Path $env:TEMP "deskcomm-docker-out.txt"
$tmpErr = Join-Path $env:TEMP "deskcomm-docker-err.txt"

Write-Host "==> conferindo o Docker" -ForegroundColor Cyan
if ((Invoke-Docker @("version", "--format", "{{.Server.Version}}") $tmpOut $tmpErr) -ne 0) {
  Write-Host "Docker nao esta respondendo -- este script usa a imagem postgres para falar com o banco." -ForegroundColor Red
  exit 1
}
Write-Host ("    servidor " + (Get-Content $tmpOut -Raw).Trim())

# Baixa ANTES, e mostra que esta baixando. Deixar o pull acontecer implicitamente
# dentro do primeiro `docker run` faz o script parecer travado por minutos --
# e foi o que produziu a mensagem que abortou a versao anterior.
Write-Host ("==> garantindo a imagem " + $IMAGEM + " (baixa na primeira vez, ~1 min)") -ForegroundColor Cyan
if ((Invoke-Docker @("pull", $IMAGEM) $tmpOut $tmpErr) -ne 0) {
  Write-Host "nao consegui baixar a imagem:" -ForegroundColor Red
  Get-Content $tmpErr | Select-Object -First 5 | ForEach-Object { Write-Host ("   " + $_) }
  exit 1
}
Write-Host "    imagem pronta"

# Copia para caminho SEM espaco nem acento (ver armadilha 4 no cabecalho).
$tmpSql = Join-Path $env:TEMP "deskcomm-baseline.sql"
Copy-Item -LiteralPath $baseline -Destination $tmpSql -Force
$montagem = ($tmpSql -replace '\\', '/') + ":/b.sql:ro"

Write-Host "==> extensoes que o schema exige (idempotente)" -ForegroundColor Cyan
$sqlExt = "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;"
# Sem checar o codigo: num Supabase gerenciado as extensoes ja existem e a role
# do app pode nao ter permissao de cria-las. Falhar aqui pararia um script que
# so precisava seguir em frente.
Invoke-Docker @("run", "--rm", $IMAGEM, "psql", $url, "-c", $sqlExt) $tmpOut $tmpErr | Out-Null

Write-Host "==> aplicando baseline.sql (leva ~1 min e imprime muitos 'already exists')" -ForegroundColor Cyan
$log = Join-Path $env:TEMP "baseline-producao.log"
$logErr = Join-Path $env:TEMP "baseline-producao-err.log"
$codigo = Invoke-Docker @("run", "--rm", "-v", $montagem, $IMAGEM, "psql", $url, "-f", "/b.sql") $log $logErr

# Os mesmos "erros benignos" que o update.sh filtra ao re-aplicar sobre uma base
# que ja existe. Sem esta lista, uma re-aplicacao normal pareceria catastrofe.
$benigno = 'already exists|multiple primary keys|multiple default values|is already a member|already a partition'
$linhas = @()
foreach ($f in @($log, $logErr)) {
  if (Test-Path $f) { $linhas += Get-Content $f }
}
$inesperados = $linhas | Where-Object { $_ -match "ERROR|FATAL" } | Where-Object { $_ -notmatch $benigno }

if ($inesperados) {
  Write-Host ""
  Write-Host "ERROS QUE NAO SAO BENIGNOS -- leia antes de seguir:" -ForegroundColor Red
  $inesperados | Select-Object -First 20 | ForEach-Object { Write-Host ("   " + $_) }
  Write-Host ("log: " + $log + " e " + $logErr)

  # O host nao resolver NAO e erro de SQL, e a mensagem generica acima manda a
  # pessoa procurar no lugar errado. Num Supabase self-hosted a URL costuma
  # apontar para `db` -- nome do servico DENTRO da rede docker do compose --, que
  # so resolve de dentro daquela rede. Nenhum ajuste neste script alcanca esse
  # banco a partir de outra maquina: o comando tem de rodar NA VPS.
  if ($inesperados -match "could not translate host name|Name does not resolve|no such host") {
    Write-Host ""
    Write-Host "O HOST DO BANCO NAO RESOLVE DAQUI." -ForegroundColor Yellow
    Write-Host "  A URL aponta para um nome interno da rede docker (ex.: 'db')." -ForegroundColor Yellow
    Write-Host "  Rode este passo NA VPS, ou use o SQL Editor do Supabase Studio." -ForegroundColor Yellow
  }
  exit 1
} else {
  Write-Host "OK: baseline aplicado (so erros benignos de re-aplicacao)" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> conferindo as colunas da migration 0206" -ForegroundColor Cyan
# A prova de que o passo funcionou nao e "o script terminou": e a coluna existir.
$sqlCheck = "select coalesce(string_agg(column_name, ', ' order by column_name), '(NENHUMA)') from information_schema.columns where table_name = 'channel_sessions' and column_name in ('provider_mode', 'stevo_instance_id', 'stevo_token_encrypted');"
Invoke-Docker @("run", "--rm", $IMAGEM, "psql", $url, "-t", "-A", "-c", $sqlCheck) $tmpOut $tmpErr | Out-Null
# `-Raw` num arquivo VAZIO devolve $null, e `.Trim()` sobre null estoura
# ("Nao e possivel chamar um metodo em uma expressao de valor nulo") -- que foi
# o que aconteceu quando o psql nao conseguiu sequer conectar. O erro real fica
# escondido atras de um erro de PowerShell.
$achadas = ""
if (Test-Path $tmpOut) {
  $conteudo = Get-Content $tmpOut -Raw
  if ($null -ne $conteudo) { $achadas = $conteudo.Trim() }
}
if ([string]::IsNullOrWhiteSpace($achadas)) { $achadas = "(nao consegui consultar -- veja o erro acima)" }

Write-Host ("    encontrado: " + $achadas)
if ($achadas -like "*provider_mode*" -and $achadas -like "*stevo_instance_id*" -and $achadas -like "*stevo_token_encrypted*") {
  Write-Host "OK: banco em dia -- a tela deve parar de acusar atraso." -ForegroundColor Green
} else {
  Write-Host "As tres colunas esperadas NAO estao todas la:" -ForegroundColor Red
  Write-Host "  provider_mode, stevo_instance_id, stevo_token_encrypted" -ForegroundColor Yellow
  Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Write-Host ("   " + $_) }
}

Remove-Item -LiteralPath $tmpSql -Force -ErrorAction SilentlyContinue
