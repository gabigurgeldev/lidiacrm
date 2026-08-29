# Atualizar o CRM nesta instalação (EasyPanel)

> Vale só para `lidiacrm.com.br`, onde o CRM e o Supabase são serviços `compose`
> do EasyPanel. **O `update.sh` do kit não serve aqui** — ele exige que uma
> árvore em disco seja dona dos contêineres (invariante 8 de
> `docs/doctrine/packaging.md`), e aqui quem é dono é o painel. O cron do
> `agent.sh` e o botão **"Atualizar agora"** da tela também não existem nesta
> instalação: os dois dependem da mesma árvore.
>
> Em troca, nada é construído na VPS — as imagens continuam sendo as publicadas
> (invariante 1 da mesma doutrina).

## Onde as coisas estão

| Coisa | Caminho / valor |
|---|---|
| VPS | `46.202.147.142` (Ubuntu 24.04, Docker 29.7.1, Swarm ativo pelo EasyPanel) |
| Painel | `https://admin.lidiacrm.com.br`, projeto `lidiacrm` |
| Serviços | `lidiacrm/crm` e `lidiacrm/supabase`, ambos tipo `compose` |
| Compose do CRM | `/etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel/` |
| **`.env` que vale** | `…/deploy/easypanel/.env` — ver o aviso abaixo |
| Compose do Supabase | `/etc/easypanel/projects/lidiacrm/supabase/code/supabase/code/` |
| Segredos | `/root/segredos-crm.env`, `/root/segredos-supabase.env` (modo 600) |
| Projetos docker | `lidiacrm_crm` e `lidiacrm_supabase` |

### ⚠️ A env do painel NÃO chega ao compose

Medido nesta instalação: o EasyPanel guarda a env do serviço, mas quem o
`docker compose` lê é o `.env` no diretório de trabalho. A tela de variáveis do
painel **não** governa um serviço `compose` aqui — `createDotEnv: true` criou o
arquivo vazio e a flag voltou a `None` sozinha.

**Consequência prática:** mudar variável pela tela não tem efeito. Edite o
`.env` no caminho acima e suba de novo. Reflita a mesma mudança no painel se
quiser que a tela não minta, mas o arquivo é a fonte da verdade.

**E nunca chame `services.compose.updateEnv` sem o campo `env`:** ele substitui
tudo, e omitir o campo **apaga** a env guardada. Aconteceu aqui uma vez.

## Atualizar para uma versão nova

O `.env` fixa as três imagens em número de versão, com `pull_policy: missing` —
tag imutável não precisa ser re-puxada (invariantes 3 e 5 do packaging).

### 1. Descubra a versão publicada

```bash
t=$(curl -s "https://ghcr.io/token?scope=repository:melgarafael/deskcommcrm:pull&service=ghcr.io" \
     | grep -o '"token":"[^"]*' | cut -c10-)
curl -s -H "Authorization: Bearer $t" \
  https://ghcr.io/v2/melgarafael/deskcommcrm/tags/list \
  | tr ',' '\n' | grep -oE '"1\.[0-9]+\.[0-9]+"' | tr -d '"' | sort -V | tail -5
```

Confira que as **três** imagens existem nessa versão antes de seguir — o ciclo
de release é acoplado (ADR 0001, decisão D2), e uma faltando significa release
incompleta:

```bash
for i in deskcommcrm deskcomm-worker deskcomm-scheduler; do
  t=$(curl -s "https://ghcr.io/token?scope=repository:melgarafael/$i:pull&service=ghcr.io" \
       | grep -o '"token":"[^"]*' | cut -c10-)
  printf '%-20s ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $t" \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    "https://ghcr.io/v2/melgarafael/$i/manifests/<VERSAO>"
done   # 200 nas três, ou não atualize
```

### 2. Backup do banco — antes de qualquer coisa

O `update.sh` fazia isto sozinho; aqui é você. **Não pule**: o passo 4 aplica
schema, e schema aplicado não tem desfazer.

```bash
. /root/segredos-supabase.env
docker run --rm --network lidiacrm_supabase_default postgres:17-alpine \
  pg_dump --no-owner --no-privileges \
  "postgresql://postgres:$POSTGRES_PASSWORD@db:5432/postgres" \
  | gzip > /root/backup-$(date +%Y%m%d-%H%M).sql.gz
ls -lh /root/backup-*.sql.gz | tail -1
```

### 3. Troque as tags no `.env`

```bash
cd /etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel
cp .env .env.bak.$(date +%s)
sed -i 's#\(deskcommcrm\|deskcomm-worker\|deskcomm-scheduler\):[0-9.]*#\1:<VERSAO>#' .env
grep -E '^(APP|WORKER|SCHEDULER)_IMAGE=' .env
```

### 4. Banco antes do app

Sempre nesta ordem: app novo sobre schema velho quebra; schema novo sob app
velho costuma tolerar.

```bash
cd /etc/easypanel/projects/lidiacrm/crm/code
git fetch --quiet origin && git checkout deploy/easypanel && git pull --quiet
. /root/segredos-supabase.env
docker run --rm -i --network lidiacrm_supabase_default \
  -v "$PWD/supabase/baseline.sql:/b.sql:ro" postgres:17-alpine \
  psql "postgresql://postgres:$POSTGRES_PASSWORD@db:5432/postgres" -f /b.sql 2>&1 | tail -20
```

**Sem `ON_ERROR_STOP=1` aqui, de propósito.** Re-aplicar em banco existente
gera muitos `already exists` / `multiple primary keys`, que são esperados. Erros
que **não** são benignos e pedem parada: `permission denied`, `must be owner`,
qualquer coisa sobre `column … does not exist`.

### 5. Suba

```bash
cd /etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel
docker compose -p lidiacrm_crm pull
docker compose -p lidiacrm_crm up -d
```

Pode ser pelo botão **Deploy** do painel também — ele roda o equivalente. O que
o painel **não** faz é o passo 4.

### 6. Prove que subiu

`healthy` no `docker ps` **não** prova nada: o healthcheck do `app` é um probe
TCP, de propósito (`/api/v1/health` dá 503 se WAHA ou Redis caem, e o
`scheduler` depende de `app` estar healthy).

```bash
curl -o /dev/null -w 'raiz: %{http_code}\n' https://lidiacrm.com.br/     # 307
curl -s https://lidiacrm.com.br/api/v1/health                            # "healthy" + version
docker exec lidiacrm_crm-worker-1 wget -qO- http://127.0.0.1:8787/healthz
```

E os crons — cujo modo de falha é silencioso (a tela só fica velha):

```bash
. /root/segredos-crm.env
docker exec lidiacrm_crm-scheduler-1 curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer ${INTERNAL_CRON_SECRET:-$INTERNAL_SECRET}" \
  http://app:3000/api/v1/cron/event-log-drain      # 200; sem o header, 403
```

Confirme a versão na resposta do `/api/v1/health` — é ela quem responde, não o
`package.json` (invariante 7 do packaging).

### 7. Se der errado

```bash
cd /etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel
cp .env.bak.<timestamp> .env          # volta as tags antigas
docker compose -p lidiacrm_crm up -d
```

Rollback de imagem é barato. **Rollback de schema não existe** — para isso é o
backup do passo 2, restaurado em banco novo.

## Armadilhas desta instalação

1. **`docker-compose.yml` daqui é cópia do `docker-compose.prod.yml`**, feita na
   v1.10.1. Ao subir de versão, compare os dois: serviço novo ou variável nova
   lá não chega aqui sozinho.
2. **O nome do serviço `app` é contrato.** `docker/scheduler/entrypoint.sh` fala
   com `http://app:3000` — constante, não configurável. Renomear cala os 22
   crons sem erro nenhum.
3. **A rede `supabase` é externa** (`lidiacrm_supabase_default`). Se o serviço
   `supabase` for recriado do zero, confirme que o nome da rede não mudou —
   `SUPABASE_NETWORK` no `.env` existe para esse ajuste.
4. **O `.env` do Supabase é gerado pelo EasyPanel** e vence o que a tela diz.
   Vive em `…/supabase/code/supabase/code/.env`. As URLs públicas
   (`SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`) foram corrigidas ali à mão; se um
   dia o painel regerar o arquivo, elas voltam para `localhost` e o login
   quebra.
5. **`SRH_TOKEN` e `UPSTASH_REDIS_REST_TOKEN` são o mesmo valor** — dois lados
   da mesma credencial (`install.sh:1281`). Gerá-los diferentes dá
   `redis: http_401 credencial_recusada` no health, com todo o resto verde.
