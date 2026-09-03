/**
 * O SCHEMA CHEGA A QUEM IMPLANTA POR PAINEL — os quatro elos, cada um vigiado.
 *
 * ## O defeito que este arquivo fecha
 *
 * A cadeia `merge → publish-image → deploy` entrega CÓDIGO novo e deixa o SCHEMA
 * para trás: nenhum passo dela toca no banco. Quem aplicava o `baseline.sql` era
 * o `update.sh` do kit, que roda por SSH na VPS — e um deploy por painel
 * (EasyPanel, Coolify, Dokploy) nunca o executa.
 *
 * O sintoma não aponta para a causa: o deploy passa verde, o app sobe, e alguma
 * tela devolve menos dado. A maioria nem reclama — as consultas são tolerantes a
 * coluna ausente de propósito, então elas DEGRADAM EM SILÊNCIO. Medido em
 * produção: a migration 0206 subiu no código e ficou pendente no banco até
 * alguém abrir Conexões e ver o aviso.
 *
 * ## Por que quatro asserções e não uma
 *
 * O mecanismo tem quatro elos, e qualquer um que se solte devolve o defeito
 * inteiro — sem barulho, porque nada quebra: o app sobe igual.
 *
 *   1. o serviço existe no compose
 *   2. o app ESPERA por ele (e espera COMPLETAR, não iniciar)
 *   3. o baseline viaja na imagem (senão o serviço não tem o que aplicar)
 *   4. o script viaja na imagem (senão o `command` não existe)
 *
 * ## A asserção que carrega o arquivo
 *
 * A quinta: o aplicador NÃO pode morar nas raízes de código de app. Ele lê
 * `SUPABASE_DB_ADMIN_URL` — a conexão de DDL, dona do banco —, e a separação
 * dela para a role menor do app é deliberada (issue #192). Mover este script
 * para `lib/` "porque é código" devolveria ao app o poder que aquela issue
 * tirou, e o teste que vigia isso (`env-ddl-fora-do-app`) reprovaria — mas só
 * DEPOIS de alguém já ter movido. Aqui a regra fica escrita ao lado do
 * mecanismo que depende dela.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const compose = readFileSync("docker-compose.prod.yml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const aplicador = readFileSync("scripts/aplicar-schema.mjs", "utf8");

describe("o schema alcança quem implanta por painel", () => {
  it("a varredura enxerga os três arquivos (senão ela mede o vazio)", () => {
    // Controle positivo: um `readFileSync` que devolvesse string vazia faria
    // TODAS as asserções abaixo passarem por vacuidade.
    expect(compose).toContain("services:");
    expect(dockerfile).toContain("FROM node:22-alpine");
    expect(aplicador).toContain("baseline");
  });

  it("elo 1: existe um serviço que aplica o schema", () => {
    expect(compose, "o serviço `migrate` sumiu do compose").toMatch(/^ {2}migrate:/m);
    expect(compose, "o serviço não roda o aplicador").toContain("scripts/aplicar-schema.mjs");
  });

  it("elo 2: o app ESPERA o schema, e espera COMPLETAR", () => {
    // `service_started` seria pior que nada aqui: o migrate é efêmero, então
    // "iniciou" é verdade um instante depois de subir — e o app leria o banco
    // no meio da aplicação, que é o pior instante possível.
    const depends = compose.slice(compose.indexOf("\n  app:"));
    expect(depends, "o app não declara depends_on de migrate").toMatch(/migrate:\s*\n\s*condition:/);
    expect(depends, "o app espera INICIAR em vez de COMPLETAR").toMatch(
      /migrate:\s*\n\s*condition:\s*service_completed_successfully/,
    );
  });

  it("elo 3: o baseline viaja na imagem", () => {
    // Sem isto o serviço sobe, não acha o arquivo, loga e sai — e o desfecho é
    // idêntico ao de não existir serviço nenhum.
    expect(dockerfile, "o Dockerfile não copia o baseline").toMatch(
      /COPY[^\n]*baseline\.sql[^\n]*\.\/supabase\/baseline\.sql/,
    );
  });

  it("elo 4: o aplicador viaja na imagem", () => {
    expect(dockerfile, "o Dockerfile não copia o aplicador").toMatch(
      /COPY[^\n]*aplicar-schema\.mjs/,
    );
  });
});

describe("o poder de DDL não volta para o app", () => {
  it("⭐ o aplicador mora FORA das raízes de código de app", async () => {
    // `env-ddl-fora-do-app` varre app/, components/, lib/, workers/ e hooks/ e
    // reprova quem NOMEAR a variável de admin. Este script a nomeia — é o
    // trabalho dele —, e por isso vive em `scripts/`, que aquela varredura não
    // alcança. A asserção existe para que mover o arquivo "para organizar"
    // falhe AQUI, com o motivo escrito, em vez de falhar lá com um nome de
    // teste que não explica a decisão.
    const fs = await import("node:fs");
    for (const raiz of ["app", "components", "lib", "workers", "hooks"]) {
      expect(
        fs.existsSync(`${raiz}/aplicar-schema.mjs`),
        `o aplicador foi movido para ${raiz}/ — ele lê a credencial de DDL e não pode viver em raiz de app (issue #192)`,
      ).toBe(false);
    }
    expect(fs.existsSync("scripts/aplicar-schema.mjs")).toBe(true);
  });

  it("o aplicador prefere a credencial de DDL, e cai na do app só como último recurso", () => {
    // A ordem importa: num Supabase próprio a role do app NÃO consegue rodar
    // `alter table`, e tentar com ela primeiro produziria um erro de permissão
    // que se lê como "o banco recusou" em vez de "faltou a credencial certa".
    const i = aplicador.indexOf("SUPABASE_DB_ADMIN_URL");
    const j = aplicador.indexOf("SUPABASE_DB_URL", i + 1);
    expect(i, "o aplicador não lê a credencial de DDL").toBeGreaterThan(-1);
    expect(j, "o aplicador não tem fallback para a URL do app").toBeGreaterThan(i);
  });
});

describe("o mecanismo não pode derrubar o parque", () => {
  it("o serviço não reinicia em laço", () => {
    // Um efêmero com `restart: unless-stopped` reaplicaria schema para sempre.
    const bloco = compose.slice(compose.indexOf("\n  migrate:"), compose.indexOf("\n  app:"));
    expect(bloco).toMatch(/restart:\s*"no"/);
  });

  it("o aplicador sai com 0 mesmo quando falha", () => {
    // `service_completed_successfully` trava o app se o migrate sair != 0.
    // Banco fora do ar por um minuto derrubaria o CRM inteiro — trocaria uma
    // degradação parcial (schema velho, telas tolerando) por queda total.
    expect(aplicador).toMatch(/process\.exit\(0\)/);
    expect(aplicador, "o erro precisa ir para o log em voz alta").toMatch(/log\("error"/);
  });
});
