/**
 * MARCAR, DESMARCAR E DECIDIR PELO MARCADOR — pela tela.
 *
 * ## Por que esta spec existe
 *
 * A suíte de unidade prova as REGRAS: que marcar sem lead cai no contato, que
 * "não tem o marcador" responde verdade quando não há lead, que o bloco avança.
 * Nada disso prova o que a pessoa compra — que os DOIS blocos estão na paleta,
 * que o cartão do quadro diz o que o bloco faz, e que o "Decidir" oferece a
 * pergunta pronta em vez de exigir que alguém digite `contact.tags` e escolha
 * um operador.
 *
 * O vão é exatamente o da queixa que originou o trabalho: "o marcar tag não
 * marca o lead nem passa pra frente" e "não consigo ter a lógica de marcado vs
 * não marcado". As duas eram verdade pela tela.
 *
 * Pré-requisitos (banco fresco estilo VPS, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/fluxo-marcador-e-decisao.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

async function abrirEditorDeFluxoNovo(page: Page, rotulo: string): Promise<void> {
  await page.goto("/app/flows");
  const nome = `${rotulo} ${Date.now()}`;
  await page.getByTestId("campo-nome-do-fluxo").fill(nome);
  await page
    .getByTestId("form-novo-fluxo")
    .getByRole("button", { name: /criar fluxo/i })
    .click();
  await page.getByRole("link", { name: nome }).click();
  await page.waitForURL(/\/app\/flows\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("paleta")).toBeVisible({ timeout: 20_000 });
}

test.describe("marcar e desmarcar são dois blocos", () => {
  test("os dois estão na paleta e o cartão diz o que cada um faz", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E marcador");

    await page.getByTestId("paleta-crm.add_tag").click();
    await page.getByTestId("campo-tag").fill("vip");
    await expect(page.locator('[data-testid^="resumo-do-no-"]').last()).toHaveText(/vip/i);

    await page.getByTestId("paleta-crm.remove_tag").click();
    await page.getByTestId("campo-tag").fill("promo");
    const resumo = page.locator('[data-testid^="resumo-do-no-"]').last();
    await expect(resumo).toHaveText(/promo/i);
    // O cartão fala português de operação, nunca o identificador do bloco.
    await expect(resumo).not.toHaveText(/crm\.remove_tag/);
  });

  test("o bloco de marcar tem a saída de quando NÃO deu", async ({ page }) => {
    // É a saída que troca a morte calada por um caminho que a pessoa vê. Antes o
    // bloco respondia `dead` e a execução sumia sem uma linha na tela.
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E marcador saida");

    await page.getByTestId("paleta-crm.add_tag").click();
    await page.getByTestId("campo-tag").fill("vip");

    await expect(page.locator('[data-handleid="nao_marcou"]')).toHaveCount(1);
    await expect(page.locator('[data-handleid="else"]')).toHaveCount(1);
  });
});

test.describe("o Decidir pergunta pelo marcador", () => {
  test("a pergunta pronta existe e não pede caminho nenhum", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E decidir marcador");

    await page.getByTestId("paleta-logic.if").click();

    // A saída nasce no editor de campo cru; trocar para a pergunta de marcador é
    // uma escolha, e ela tem de estar na tela — não num `lead.tags` digitado.
    const painel = page.getByTestId("painel-do-no");
    const saida = painel.locator('[data-testid^="saida-"]').first();
    const idDaSaida = (await saida.getAttribute("data-testid"))!.replace("saida-", "");

    await page.getByTestId(`modo-${idDaSaida}-0`).click();
    await page.getByRole("option", { name: /tem o marcador/i }).click();

    await page.getByTestId(`marcador-tag-${idDaSaida}-0`).fill("vip");
    await expect(page.getByTestId(`marcador-tem-${idDaSaida}-0`)).toContainText(/está marcado/i);
    // O editor de caminho sumiu: quem escolheu a pergunta pronta não precisa
    // saber que existe um campo chamado `contact.tags`.
    await expect(page.getByTestId(`campo-da-regra-${idDaSaida}-0`)).toHaveCount(0);
  });

  test("dá para ter a saída de marcado E a de não marcado no mesmo bloco", async ({ page }) => {
    // É a queixa literal: "quando o cliente tá marcado vai por um caminho, e
    // quando não tá vai pelo outro".
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E decidir dois lados");

    await page.getByTestId("paleta-logic.if").click();
    const painel = page.getByTestId("painel-do-no");
    const primeira = painel.locator('[data-testid^="saida-"]').first();
    const id1 = (await primeira.getAttribute("data-testid"))!.replace("saida-", "");

    await page.getByTestId(`modo-${id1}-0`).click();
    await page.getByRole("option", { name: /tem o marcador/i }).click();
    await page.getByTestId(`marcador-tag-${id1}-0`).fill("vip");

    await page.getByTestId("acrescentar-saida").click();
    const segunda = painel.locator('[data-testid^="saida-"]').nth(1);
    const id2 = (await segunda.getAttribute("data-testid"))!.replace("saida-", "");

    await page.getByTestId(`modo-${id2}-0`).click();
    await page.getByRole("option", { name: /tem o marcador/i }).click();
    await page.getByTestId(`marcador-tem-${id2}-0`).click();
    await page.getByRole("option", { name: /não está marcado/i }).click();
    await page.getByTestId(`marcador-tag-${id2}-0`).fill("vip");

    // Duas saídas de regra no quadro, mais o pega-tudo: os dois caminhos que a
    // pessoa queria desenhar existem como handles para ligar.
    await expect(page.locator(`[data-handleid="${id1}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-handleid="${id2}"]`)).toHaveCount(1);
  });

  test("acrescentar regra na mesma saída, com E/OU", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E decidir composto");

    await page.getByTestId("paleta-logic.if").click();
    const painel = page.getByTestId("painel-do-no");
    const saida = painel.locator('[data-testid^="saida-"]').first();
    const id = (await saida.getAttribute("data-testid"))!.replace("saida-", "");

    await expect(page.getByTestId(`combinador-${id}`)).toHaveCount(0);
    await page.getByTestId(`acrescentar-regra-${id}`).click();
    await expect(page.getByTestId(`combinador-${id}`)).toBeVisible();
  });
});
