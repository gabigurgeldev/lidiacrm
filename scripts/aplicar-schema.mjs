/**
 * Aplica `supabase/baseline.sql` ANTES de o app subir — o passo que faltava em
 * toda instalação que implanta por painel.
 *
 * ═══ O defeito que este arquivo fecha ═══
 *
 * A cadeia `merge → publish-image → deploy` entrega CÓDIGO novo e deixa o SCHEMA
 * para trás: nenhum passo dela toca no banco. Quem aplica o baseline é o
 * `update.sh` do kit, que roda na VPS por SSH — e um deploy por painel
 * (EasyPanel, Coolify, Dokploy) nunca o executa.
 *
 * O sintoma não aponta para cá: o deploy passa verde, o app sobe, e alguma tela
 * começa a devolver menos dado. A maioria das telas nem reclama — as consultas
 * são tolerantes a coluna ausente de propósito, então elas degradam em silêncio.
 * Medido em produção: a migration 0206 subiu no código e ficou pendente no banco
 * até alguém abrir Conexões e ver o aviso.
 *
 * ═══ Por que um SERVIÇO separado, e não o boot do app ═══
 *
 * Porque `SUPABASE_DB_ADMIN_URL` é a conexão de DDL — dona do banco quando a
 * instalação usa Supabase próprio — e `SUPABASE_DB_URL` é a role menor que o app
 * usa. A separação é deliberada (issue #192), e `tests/unit/env-ddl-fora-do-app.test.ts`
 * reprova o build se qualquer arquivo de `app/`, `lib/`, `workers/`,
 * `components/` ou `hooks/` sequer NOMEAR a variável de admin.
 *
 * Aplicar no boot do app daria a ele exatamente o poder que aquela issue tirou.
 * Este script vive em `scripts/` — fora das raízes varridas — e é executado por
 * um serviço EFÊMERO do compose, que sobe, aplica e sai. O app continua sem DDL.
 *
 * ═══ Por que compara um CARIMBO em vez de aplicar sempre ═══
 *
 * O baseline tem ~17 mil linhas e leva perto de um minuto. Aplicá-lo a cada boot
 * atrasaria todo restart do parque por nada — e restart acontece por OOM, por
 * troca de imagem, por reboot da VPS. O carimbo é o SHA-256 do arquivo: se o que
 * está gravado no banco bate com o da imagem, não há o que fazer.
 *
 * ═══ Falha NÃO derruba o deploy ═══
 *
 * Sai com 0 mesmo quando não conseguiu aplicar, e isso é escolha, não descuido.
 * O estado "schema atrasado" é o que já existe hoje, e as telas o toleram; um
 * app que se recusa a subir por causa disso trocaria uma degradação parcial por
 * uma queda total. O erro vai para o log em voz alta, e a tela de Conexões
 * continua sendo quem avisa o operador.
 *
 * A exceção é o LOCK: se outro contêiner está aplicando agora, este espera em
 * vez de aplicar junto — duas sessões rodando o mesmo DDL ao mesmo tempo é como
 * se ganha um deadlock em produção.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

/** Onde o Dockerfile deposita o baseline dentro da imagem. */
const CAMINHO_BASELINE = process.env.BASELINE_PATH ?? "/app/supabase/baseline.sql";

/**
 * Chave do advisory lock. Número fixo e arbitrário — o que importa é que TODA
 * réplica use o mesmo, para que a segunda espere em vez de aplicar em paralelo.
 */
const CHAVE_DO_LOCK = 920601;

/** Tabela do carimbo. Nome no vocabulário do repo, não `schema_migrations`. */
const TABELA_CARIMBO = "public.app_schema_estado";

function log(nivel, msg, extra) {
  const linha = { level: nivel, msg: `[schema] ${msg}`, ts: new Date().toISOString(), ...extra };
  // stdout puro: este processo morre antes de qualquer logger do app existir.
  console.log(JSON.stringify(linha));
}

async function main() {
  // A URL de DDL primeiro; a do app como último recurso. Numa instalação em
  // Supabase gerenciado as duas são a mesma string, e ali não há separação a
  // respeitar. Onde HÁ (Supabase próprio), a de admin é a única que consegue
  // rodar `alter table`.
  const url = process.env.SUPABASE_DB_ADMIN_URL || process.env.SUPABASE_DB_URL;
  if (!url) {
    log("warn", "sem SUPABASE_DB_ADMIN_URL nem SUPABASE_DB_URL — nada a fazer");
    return;
  }

  let sql;
  try {
    sql = await readFile(path.resolve(CAMINHO_BASELINE), "utf8");
  } catch (err) {
    log("error", "baseline nao encontrado na imagem", {
      caminho: CAMINHO_BASELINE,
      detail: String(err?.message ?? err).slice(0, 200),
    });
    return;
  }

  const carimbo = createHash("sha256").update(sql).digest("hex").slice(0, 16);
  const cliente = new pg.Client({
    connectionString: url,
    // O baseline é longo; um timeout curto o mataria no meio, deixando o schema
    // pela metade -- pior que não ter começado.
    statement_timeout: 10 * 60 * 1000,
    connectionTimeoutMillis: 30_000,
  });

  try {
    await cliente.connect();
  } catch (err) {
    log("error", "nao consegui conectar ao banco — o schema segue como esta", {
      detail: String(err?.message ?? err).slice(0, 200),
    });
    return;
  }

  try {
    // Espera a vez em vez de aplicar em paralelo: `pg_advisory_lock` bloqueia
    // até o outro liberar, e a liberação é automática no fim da sessão.
    await cliente.query("select pg_advisory_lock($1)", [CHAVE_DO_LOCK]);

    await cliente.query(`
      create table if not exists ${TABELA_CARIMBO} (
        chave text primary key,
        valor text not null,
        atualizado_em timestamptz not null default now()
      )
    `);

    const { rows } = await cliente.query(
      `select valor from ${TABELA_CARIMBO} where chave = 'baseline_sha'`,
    );
    if (rows[0]?.valor === carimbo) {
      log("info", "schema ja em dia", { carimbo });
      return;
    }

    log("info", "aplicando baseline", { carimbo, anterior: rows[0]?.valor ?? "(nenhum)" });
    // Sem transação envolvendo tudo, e de propósito: o baseline cria índices e
    // extensões que não podem rodar dentro de bloco transacional, e um `begin`
    // aqui faria a re-aplicação inteira abortar no primeiro deles.
    await cliente.query(sql);

    await cliente.query(
      `insert into ${TABELA_CARIMBO} (chave, valor, atualizado_em)
       values ('baseline_sha', $1, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
      [carimbo],
    );
    log("info", "schema aplicado", { carimbo });
  } catch (err) {
    // Erro de SQL aqui é ruidoso de propósito: ele é a diferença entre "o banco
    // está velho" e "o banco está velho E ninguém sabe por quê".
    log("error", "falha ao aplicar o schema — o app sobe com o banco como esta", {
      detail: String(err?.message ?? err).slice(0, 400),
    });
  } finally {
    await cliente.end().catch(() => {});
  }
}

// Nunca derruba o deploy: ver o cabeçalho.
main()
  .catch((err) => {
    log("error", "erro inesperado", { detail: String(err?.message ?? err).slice(0, 300) });
  })
  .finally(() => process.exit(0));
