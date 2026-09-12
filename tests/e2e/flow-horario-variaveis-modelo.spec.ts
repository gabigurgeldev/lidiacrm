/**
 * EXPEDIENTE, VARIÁVEIS E MODELO APROVADO — pela tela.
 *
 * ## Por que esta spec existe
 *
 * A suíte de unidade prova as REGRAS: que a conta do horário acerta a virada da
 * semana, que o seletor insere na posição do cursor, que o modo de modelo chega
 * à porta de envio. Nenhuma delas prova o que a pessoa compra — que o bloco
 * ESTÁ na paleta, que o botão de variável APARECE ao lado do campo, e que
 * escolher "usar um modelo aprovado" troca o formulário de verdade.
 *
 * Esse vão já foi pago neste mesmo editor: o painel de um bloco pedia o `id` de
 * algo que a tela nunca mostrava, com a regra certa e testada por baixo. É a
 * doutrina de QA Visual do repo — `curl` valida o backend, não a UX.
 *
 * Pré-requisitos (banco fresco estilo VPS, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/flow-horario-variaveis-modelo.spec.ts
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

test.describe("o fluxo sabe que horas são", () => {
  test("o bloco de horário está na paleta e nasce em seg a sex", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E horario");

    await page.getByTestId("paleta-logic.business_hours").click();

    // O cartão do quadro diz o expediente sem abrir o bloco — é a razão de o
    // resumo existir, e o que distingue dois blocos de horário no mesmo fluxo.
    const resumo = page.locator('[data-testid^="resumo-do-no-"]').last();
    await expect(resumo).toHaveText(/Seg a Sex/i);
    await expect(resumo).not.toHaveText(/logic\.business_hours/);

    // Sábado desmarcado: o padrão é seg a sex, e é o que a maioria quer.
    await expect(page.getByTestId("dia-6")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("dia-1")).toHaveAttribute("aria-pressed", "true");
  });

  test("marcar sábado muda o cartão, e a escolha de fora-do-horário aparece", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E horario sabado");

    await page.getByTestId("paleta-logic.business_hours").click();
    await page.getByTestId("dia-6").click();
    await page.getByTestId("dia-0").click();

    const resumo = page.locator('[data-testid^="resumo-do-no-"]').last();
    await expect(resumo).toHaveText(/Todo dia/i);
    await expect(page.getByTestId("campo-fora-do-horario")).toBeVisible();
  });
});

test.describe("o campo diz quais variáveis existem", () => {
  test("o botão abre a lista e insere o marcador no texto", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E variavel");

    await page.getByTestId("paleta-whatsapp.send_to_lead").click();
    const campo = page.getByTestId("campo-texto-ao-cliente");
    await campo.fill("Oi ");

    await page.getByTestId("abrir-variaveis").first().click();
    await page.getByTestId("variavel-contact.name").click();

    // O marcador ENTRA no campo. Antes, a única pista de que ele existia era uma
    // frase de ajuda embaixo — e errar o nome sai como mensagem com buraco.
    await expect(campo).toHaveValue(/\{\{contact\.name\}\}/);
  });
});

test.describe("mandar por modelo aprovado", () => {
  test("a escolha de COMO enviar troca o formulário", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E modelo");

    await page.getByTestId("paleta-whatsapp.send_to_lead").click();

    // Começa em texto livre: é o caso comum, e o bloco nasce com uma mensagem.
    await expect(page.getByTestId("campo-texto-ao-cliente")).toBeVisible();

    await page.getByTestId("campo-modo-de-envio").click();
    await page.getByRole("option", { name: /modelo aprovado/i }).click();

    // O campo de texto SAI e o de modelo entra. Deixar os dois na tela faria a
    // pessoa escrever uma mensagem que o envio ignora.
    await expect(page.getByTestId("campo-texto-ao-cliente")).toHaveCount(0);
    // Sem conexão com definições nesta instalação, o caminho oferecido é
    // escrever o nome do modelo — e não um seletor vazio sem saída.
    await expect(
      page.getByTestId("campo-modelo").or(page.getByTestId("campo-modelo-nome")),
    ).toBeVisible();
  });

  test("o aviso ao vendedor também oferece o modelo", async ({ page }) => {
    // O bloco de aviso manda 1:1 pelo mesmo caminho: numa conexão oficial, o
    // vendedor que não escreve há mais de 24h só recebe modelo aprovado — e é
    // ele quem precisa ser avisado.
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E modelo aviso");

    await page.getByTestId("paleta-whatsapp.notify_user").click();
    await expect(page.getByTestId("campo-mensagem-do-aviso")).toBeVisible();

    await page.getByTestId("campo-modo-de-envio").click();
    await page.getByRole("option", { name: /modelo aprovado/i }).click();

    await expect(page.getByTestId("campo-mensagem-do-aviso")).toHaveCount(0);
  });
});
