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
 * Aqui as duas rotas são interceptadas com `page.route`, servindo um plano e um
 * grafo canônicos. Não é o provedor de verdade — e isso está dito —, mas prova o
 * que nenhum teste de servidor prova: que o esqueleto aparece antes dos configs,
 * que um bloco em valores padrão é ANUNCIADO, que "Salvar rascunho" persiste o
 * que está no quadro, e que uma falha na montagem NÃO apaga o esqueleto.
 *
 * ## ⚠️ A ROTA DE MONTAGEM ERA UM STREAM SSE, E ESTA SPEC SERVIA UM GRAVADO
 *
 * Ela deixou de ser: numa VPS real o stream não atravessava o proxy e a tela
 * travava em "Montando N blocos…" para sempre. As duas rotas são JSON agora, e
 * o `sse()` que existia aqui foi embora com ele. O diagnóstico completo está no
 * cabeçalho de `app/api/v1/flows/[id]/ai/montar/route.ts`.
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
import { expect, test, type Page } from "@playwright/test";

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

/**
 * O corpo da rota `montar` depois que ela virou JSON.
 *
 * `comExemplo: 1` de propósito: um bloco em valores padrão é o caso cuja
 * ausência de aviso faria a tela parecer que funcionou.
 */
const MONTAGEM = { grafo: GRAFO, comExemplo: 1, descartes: [] };

/** Cria um fluxo pela tela e abre o editor dele. */
async function abrirFluxoNovo(page: Page): Promise<void> {
  await page.goto("/app/flows");
  const nome = `E2E montagem ${Date.now()}`;
  await page.getByTestId("campo-nome-do-fluxo").fill(nome);
  await page.getByTestId("form-novo-fluxo").getByRole("button", { name: /criar fluxo/i }).click();
  await page.getByRole("link", { name: nome }).click();
  await page.waitForURL(/\/app\/flows\/[0-9a-f-]{36}/);
}

/** As duas rotas que antecedem a montagem, sempre iguais. */
async function interceptarAteOPlano(page: Page): Promise<void> {
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
}

/** Vai do editor aberto até o clique em "Montar o fluxo". */
async function pedirEMontar(page: Page): Promise<void> {
  await page.getByTestId("abrir-construtor-ia").click();
  await expect(page.getByTestId("construtor-com-ia")).toBeVisible();
  await page.getByTestId("ia-pedido").fill("avisa o vendedor quando o lead ficar sem resposta");
  await page.getByTestId("ia-continuar").click();
  const montar = page.getByTestId("ia-montar");
  await expect(montar).toBeVisible({ timeout: 20_000 });
  await montar.click();
}

test.describe("montar fluxo com IA (rotas interceptadas)", () => {
  test("o esqueleto aparece, o padrão é anunciado e salva", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await interceptarAteOPlano(page);
    await page.route("**/api/v1/flows/*/ai/montar", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: MONTAGEM }),
      }),
    );

    await abrirFluxoNovo(page);
    await page.getByTestId("abrir-construtor-ia").click();
    // O trilho de passos existe desde o primeiro momento — a versão anterior
    // não dizia em que ponto da conversa a pessoa estava.
    await expect(page.getByTestId("ia-passos")).toBeVisible();
    await page.getByTestId("ia-pedido").fill("avisa o vendedor quando o lead ficar sem resposta");
    await page.getByTestId("ia-continuar").click();
    const botaoMontar = page.getByTestId("ia-montar");
    await expect(botaoMontar).toBeVisible({ timeout: 20_000 });
    await botaoMontar.click();

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

  /**
   * O DESFECHO QUE A TROCA DE TRANSPORTE TORNOU POSSÍVEL — E OBRIGATÓRIO.
   *
   * Sem o stream, a montagem é uma resposta só, e uma resposta só pode não
   * voltar (provedor caído, proxy apertado num fluxo grande). Antes, qualquer
   * falha desfazia o canvas: a pessoa via "falhou" e perdia até o esqueleto —
   * um grafo válido, com os blocos certos ligados, que ela poderia terminar à
   * mão.
   *
   * As duas asserções são inseparáveis: a tela DIZ que os blocos ficaram, e os
   * blocos ESTÃO lá. Só a primeira seria uma frase que mente; só a segunda,
   * blocos que ninguém repara.
   */
  test("a montagem falhar não apaga o esqueleto do quadro", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await interceptarAteOPlano(page);
    await page.route("**/api/v1/flows/*/ai/montar", (rota) =>
      rota.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "ai_provider_error", message: "A montagem falhou no meio. Tente de novo." },
        }),
      }),
    );

    await abrirFluxoNovo(page);
    await pedirEMontar(page);

    const nota = page.getByTestId("ia-so-esqueleto");
    await expect(nota).toBeVisible({ timeout: 20_000 });
    await expect(nota).toContainText("4");
    // A causa do servidor continua chegando à tela — não uma frase genérica.
    await expect(page.getByTestId("ia-erro")).toContainText(/falhou no meio/i);

    await page.getByTestId("ia-preencher-a-mao").click();
    await expect(page.getByTestId("construtor-com-ia")).toBeHidden();

    // Os quatro blocos do PLANO seguem no quadro, com valores padrão.
    for (const id of ["t1", "w1", "tag", "fim"]) {
      await expect(page.getByTestId(`no-${id}`)).toBeVisible({ timeout: 20_000 });
    }
  });
});
