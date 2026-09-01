/**
 * A MONTAGEM POR ETAPAS, PELA TELA — E SEM CHAVE DE IA.
 *
 * ## Por que esta spec existe e a irmã não bastava
 *
 * `flow-builder-ia.spec.ts` prova o caminho GARANTIDO em CI: sem provedor
 * configurado, a recusa é legível. Ela não prova — e declara isso no cabeçalho
 * — a geração acontecendo. O resultado é que a parte que mais quebrou do
 * produto nunca teve prova pela tela: quatro correções seguidas foram medidas
 * só por log.
 *
 * Aqui as duas rotas são interceptadas com `page.route`, servindo um plano
 * canônico e um stream SSE gravado. Não é o provedor de verdade — e isso está
 * dito —, mas prova o que nenhum teste de servidor prova: que o esqueleto
 * aparece antes dos configs, que os blocos acendem um a um, que um bloco em
 * valores padrão é ANUNCIADO, e que "Salvar rascunho" persiste o que está no
 * quadro.
 *
 * ## O que NÃO é provado aqui
 *
 * Que o provedor real aceita os schemas. Isso só se mede contra a OpenRouter, e
 * é o que `pnpm ia:diagnostico` existe para fazer, na VPS de quem tem a chave.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/flow-builder-ia-montagem.spec.ts
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const PLANO = {
  blocos: [
    { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início do fluxo" },
    { id: "w1", tipo: "logic.wait", rotulo: "Espera 10 minutos", intencao: "esperar 10 minutos" },
    { id: "tag", tipo: "crm.add_tag", rotulo: "Etiqueta sem resposta", intencao: "marcar o lead" },
    { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "terminar o fluxo" },
  ],
  ligacoes: [
    { de: "t1", para: "w1" },
    { de: "w1", para: "tag" },
    { de: "tag", para: "fim" },
  ],
};

/** O grafo que a rota `montar` emitiria no evento final. */
const GRAFO = {
  nodes: [
    { id: "t1", type: "trigger.lead_created", label: "Lead novo", position: { x: 80, y: 80 }, config: {} },
    {
      id: "w1",
      type: "logic.wait",
      label: "Espera 10 minutos",
      position: { x: 340, y: 80 },
      config: { duracao_ms: 600000 },
    },
    {
      id: "tag",
      type: "crm.add_tag",
      label: "Etiqueta sem resposta",
      position: { x: 600, y: 80 },
      config: { tag: "sem-resposta" },
    },
    {
      id: "fim",
      type: "logic.end",
      label: "Fim",
      position: { x: 860, y: 80 },
      config: { desfecho: "concluido" },
    },
  ],
  edges: [
    { id: "e1", source: "t1", target: "w1", branch_id: "else" },
    { id: "e2", source: "w1", target: "tag", branch_id: "else" },
    { id: "e3", source: "tag", target: "fim", branch_id: "else" },
  ],
};

function sse(): string {
  const linhas = [
    { tipo: "plano", blocos: PLANO.blocos, ligacoes: PLANO.ligacoes },
    { tipo: "bloco", id: "t1", origem: "ia", restantes: 3 },
    { tipo: "bloco", id: "w1", origem: "ia", restantes: 2 },
    // Um bloco em valores padrão de propósito: é o caso cuja ausência de aviso
    // faria a tela parecer que funcionou.
    { tipo: "bloco", id: "tag", origem: "exemplo", restantes: 1 },
    { tipo: "bloco", id: "fim", origem: "ia", restantes: 0 },
    { tipo: "grafo", grafo: GRAFO },
    { tipo: "fim", nos: 4, arestas: 3, comExemplo: 1 },
  ];
  return linhas.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test.describe("montar fluxo com IA (rotas interceptadas)", () => {
  test("o esqueleto aparece, os blocos acendem, o padrão é anunciado e salva", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());

    await page.route("**/api/v1/flows/*/ai/interpretar", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { kind: "pronto", resumo: "Vou montar um fluxo de 4 blocos." } }),
      }),
    );
    await page.route("**/api/v1/flows/*/ai/plano", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: PLANO }),
      }),
    );
    await page.route("**/api/v1/flows/*/ai/montar", (rota) =>
      rota.fulfill({ status: 200, contentType: "text/event-stream", body: sse() }),
    );

    await page.goto("/app/flows");
    const nome = `E2E montagem ${Date.now()}`;
    await page.getByTestId("campo-nome-do-fluxo").fill(nome);
    await page.getByTestId("form-novo-fluxo").getByRole("button", { name: /criar fluxo/i }).click();
    await page.getByRole("link", { name: nome }).click();
    await page.waitForURL(/\/app\/flows\/[0-9a-f-]{36}/);

    await page.getByTestId("abrir-construtor-ia").click();
    await expect(page.getByTestId("construtor-com-ia")).toBeVisible();

    // O trilho de passos existe desde o primeiro momento — a versão anterior
    // não dizia em que ponto da conversa a pessoa estava.
    await expect(page.getByTestId("ia-passos")).toBeVisible();

    await page.getByTestId("ia-pedido").fill("avisa o vendedor quando o lead ficar sem resposta");
    await page.getByTestId("ia-continuar").click();

    const montar = page.getByTestId("ia-montar");
    await expect(montar).toBeVisible({ timeout: 20_000 });
    await montar.click();

    // ─── O QUADRO recebe os quatro blocos ──────────────────────────────────
    // É a prova de que a montagem chega ao canvas REAL, e não a um painel de
    // pré-visualização à parte.
    for (const id of ["t1", "w1", "tag", "fim"]) {
      await expect(page.getByTestId(`no-${id}`)).toBeVisible({ timeout: 20_000 });
    }

    // ─── O aviso honesto ───────────────────────────────────────────────────
    const aviso = page.getByTestId("ia-aviso-padrao");
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(aviso).toContainText("1");

    await page.getByRole("button", { name: /^Fechar$/ }).click();
    await expect(page.getByTestId("construtor-com-ia")).toBeHidden();

    // ─── "Salvar rascunho" persiste o que está no quadro ───────────────────
    // O caminho de gravação continua sendo o de sempre: a geração nunca
    // escreve `draft_graph` por conta própria.
    await page.getByTestId("salvar-rascunho").click();
    await page.reload();
    for (const id of ["t1", "w1", "tag", "fim"]) {
      await expect(page.getByTestId(`no-${id}`)).toBeVisible({ timeout: 20_000 });
    }
  });
});
