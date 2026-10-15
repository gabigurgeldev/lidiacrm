/**
 * O agente criado a partir do modelo de um ramo já nasce com as habilidades
 * daquele ramo — e não com as dos outros.
 *
 * É a "instalação automática" da migration 0241/0242, provada pela tela como o
 * dono faria: escolhe "Loja" no Novo agente, vê a seção Habilidades já marcada,
 * cria, e confere que a marcação sobreviveu ao nascimento (é onde uma tela de
 * criação costuma perder metade do formulário).
 *
 * O que NÃO prova: que o roteiro chega ao modelo no turno. Isso é do runtime
 * (`loadSkills`, `lib/agent-engine/agent/skills.test.ts`) e do banco
 * (`tests/invariants/habilidades-por-nicho.test.ts`).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { loginComoAdmin, lerCreds, type CredsE2E } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), "evidence", "habilidades-por-ramo");

let creds: CredsE2E = lerCreds();

test.use({ locale: "pt-BR" });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  creds = await loginComoAdmin(page, creds);
});

const caixa = (page: Page, nome: string) => page.getByTestId(`habilidade-${nome}`);

test.describe("Habilidades por ramo", () => {
  test("o modelo de loja já liga as habilidades de loja, e só elas", async ({ page }) => {
    await page.goto("/app/ai/agents/new?modelo=loja");
    const secao = page.getByTestId("agente-habilidades");
    await secao.scrollIntoViewIfNeeded();
    await expect(secao).toBeVisible();

    // Universal: marcada e travada — não há o que decidir.
    await expect(caixa(page, "cliente-insatisfeito")).toBeChecked();
    await expect(caixa(page, "cliente-insatisfeito")).toBeDisabled();

    // As do ramo escolhido nascem ligadas.
    for (const nome of ["loja-rastreio-de-pedido", "loja-produto-com-problema", "loja-frete-e-entrega"]) {
      await expect(caixa(page, nome), `${nome} deveria nascer ligada no modelo de loja`).toBeChecked();
    }
    // As de outro ramo, não.
    await expect(caixa(page, "clinica-sinais-de-urgencia")).not.toBeChecked();

    await secao.screenshot({ path: path.join(EVIDENCIA, "01-loja-antes-de-criar.png") });
  });

  test("criado a partir do modelo de loja, o agente guarda as habilidades marcadas", async ({ page }) => {
    await page.goto("/app/ai/agents/new?modelo=loja");
    const nome = `Vendas da Loja ${Date.now()}`;
    await page.locator("#name").fill(nome);

    // Comboboxes do Radix: as opções só existem no DOM com o menu aberto. Sempre
    // abre e escolhe, como `agente-novo-e-uso.spec.ts`: a primeira versão desta
    // spec pulava o campo cujo texto não começava com "Selecione" — e o da chave
    // diz "Escolha uma chave". O campo ficava vazio, o Criar desabilitado, e o
    // caso reprovava por um defeito do instrumento, não do produto.
    for (const id of ["model", "credential_id", "channel_session_id"]) {
      const gatilho = page.locator(`#${id}`);
      if ((await gatilho.count()) === 0) continue;
      await gatilho.click();
      const opcoes = page.getByRole("option");
      expect(await opcoes.count(), `o campo "${id}" abriu sem nenhuma opção para escolher`).toBeGreaterThan(0);
      await opcoes.first().click();
    }

    // O dono tira uma e liga outra antes de criar — a escolha dele vale.
    await caixa(page, "loja-frete-e-entrega").uncheck();
    await caixa(page, "clinica-sinais-de-urgencia").check();

    const criar = page.getByRole("button", { name: /criar agent/i });
    await expect(criar).toBeEnabled();
    await criar.click();
    await page.waitForURL(/\/app\/ai\/agents\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText(nome).first()).toBeVisible();

    const secao = page.getByTestId("agente-habilidades");
    await secao.waitFor({ state: "visible", timeout: 60_000 });
    await expect(caixa(page, "loja-rastreio-de-pedido")).toBeChecked();
    await expect(caixa(page, "clinica-sinais-de-urgencia")).toBeChecked();
    await expect(caixa(page, "loja-frete-e-entrega")).not.toBeChecked();
    await expect(caixa(page, "cliente-insatisfeito")).toBeChecked();

    await secao.screenshot({ path: path.join(EVIDENCIA, "02-loja-depois-de-criar.png") });
  });

  test("agente em branco fica no padrão e diz isso", async ({ page }) => {
    await page.goto("/app/ai/agents/new");
    const secao = page.getByTestId("agente-habilidades");
    await secao.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("agente-habilidades-padrao")).toBeVisible();
    await expect(caixa(page, "loja-rastreio-de-pedido")).not.toBeChecked();
    await expect(caixa(page, "risco-a-vida")).toBeChecked();
    await secao.screenshot({ path: path.join(EVIDENCIA, "03-em-branco-padrao.png") });
  });
});
