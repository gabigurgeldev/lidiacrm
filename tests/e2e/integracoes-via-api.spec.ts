/**
 * INTEGRAÇÕES VIA API pela tela, como o dono do negócio faria (migration 0223).
 *
 * O caminho de primeira impressão do recurso:
 *   1. acha a tela pelo hub da Central de IA (prova a porta na navegação);
 *   2. cadastra a integração e a chave — a chave nunca volta para a tela;
 *   3. cadastra um endpoint com parâmetro;
 *   4. testa contra um endereço interno e recebe uma recusa LEGÍVEL (anti-SSRF
 *      pela tela, não por curl);
 *   5. vê o endpoint aparecer no formulário do agente, em "Sistemas que ele
 *      consulta".
 *
 * O que esta spec NÃO prova: o agente consultando de verdade no WhatsApp — isso
 * está no invariante `integracoes-api-turno.test.ts`, contra Postgres real.
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";

let creds: CredsE2E;

test.describe.configure({ timeout: 90_000, mode: "serial" });

test.beforeAll(() => {
  creds = lerCreds();
});

test.beforeEach(async ({ page }) => {
  creds = await loginComoAdmin(page, creds);
});

const NOME = `Loja E2E ${Date.now()}`;

test("cadastra integração e endpoint, e o teste contra endereço interno é recusado com frase legível", async ({ page }) => {
  await page.goto("/app/ai");
  await page.getByRole("link", { name: /Integrações via API/ }).first().click();
  await expect(page).toHaveURL(/\/app\/ai\/integracoes$/);
  await expect(page.getByRole("heading", { name: "Integrações via API" })).toBeVisible();

  await page.getByTestId("nova-integracao").click();
  await page.getByLabel("Nome do sistema").fill(NOME);
  // Endereço privado de propósito: a tela tem de recusar sem chamar a rede interna.
  await page.getByLabel("Endereço base da API").fill("https://127.0.0.1/api");
  await page.getByLabel("Chave de acesso").fill("chave-de-teste-e2e-1234");
  await page.getByTestId("int-salvar").click();

  await expect(page).toHaveURL(/\/app\/ai\/integracoes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: NOME })).toBeVisible();
  await page.screenshot({ path: "evidence/integracoes/01-integracao-criada.png", fullPage: true });

  // A chave não volta: só os 4 últimos caracteres, como dica.
  await page.getByRole("tab", { name: "Conexão" }).click();
  await expect(page.locator("#cx-segredo")).toHaveValue("");
  await expect(page.locator("#cx-segredo")).toHaveAttribute("placeholder", /1234/);

  await page.getByTestId("testar-conexao").click();
  await expect(page.getByTestId("resultado-teste-conexao")).toContainText(/interno ou privado|https/i, { timeout: 20_000 });
  await page.screenshot({ path: "evidence/integracoes/02-ssrf-recusado.png", fullPage: true });

  // Endpoint com parâmetro.
  await page.getByRole("tab", { name: "Endpoints" }).click();
  await page.getByTestId("novo-endpoint").click();
  await page.getByLabel("Título").fill("Status do pedido");
  await page.getByLabel("Identificador").fill("status_pedido");
  await page.getByLabel("Caminho").fill("/pedidos/{{params.pedido}}");
  await page.getByRole("button", { name: "Parâmetro" }).click();
  await page.getByPlaceholder("nome").first().fill("pedido");
  await page.getByTestId("ep-salvar").click();
  await expect(page.getByTestId("endpoint-linha-status_pedido")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("endpoint-linha-status_pedido").getByRole("button", { name: "Testar" }).click();
  await page.locator("#tp-pedido").fill("123");
  await page.getByTestId("tp-executar").click();
  await expect(page.getByTestId("resultado-teste-endpoint")).toContainText(/interno ou privado|https/i, { timeout: 20_000 });
  await page.screenshot({ path: "evidence/integracoes/03-endpoint-teste-recusado.png", fullPage: true });
});

test("o endpoint aparece no formulário do agente para ser marcado", async ({ page }) => {
  await page.goto("/app/ai/agents/new");
  const card = page.getByTestId("agente-integracoes");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(NOME.toUpperCase().slice(0, 4), { ignoreCase: true });
  await expect(card.getByLabel("Status do pedido")).toBeVisible();
  await page.screenshot({ path: "evidence/integracoes/04-card-no-agente.png", fullPage: true });
});
