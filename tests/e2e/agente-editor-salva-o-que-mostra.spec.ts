/**
 * O EDITOR DO AGENTE SALVA O QUE MOSTRA — provado pela tela.
 *
 * O defeito: no editor de um agente já criado, mudar o NOME marcava o
 * formulário como alterado, o toast dizia "Rascunho salvo", e o nome voltava ao
 * antigo no próximo carregamento. Pior: o formulário seguia "com alterações não
 * salvas" para sempre, e o Publicar ficava travado pedindo para salvar.
 *
 * O caminho é o de uma pessoa: cria o agente pela tela, renomeia, salva,
 * recarrega a página — e confere que o nome novo está lá e que não sobrou
 * "alteração não salva" fantasma (o "Descartar alterações" volta desabilitado).
 *
 * Fixtures de credencial e canal: `scripts/seed-e2e-followup-agent.ts`, semeado
 * pelo workflow antes das specs (ver o comentário em `.github/workflows/e2e.yml`).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect } from "@playwright/test";

import { loginComoAdmin, lerCreds, type CredsE2E } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), "evidence", "agente-editor");

let creds: CredsE2E = lerCreds();

test.use({ locale: "pt-BR" });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  creds = await loginComoAdmin(page, creds);
});

test("renomear o agente no editor salva o nome — e não deixa alteração fantasma", async ({ page }) => {
  // 1. Cria o agente pela tela, como no agente-novo-e-uso.
  await page.goto("/app/ai/agents/new");
  const nomeOriginal = `Recepção ${Date.now()}`;
  await page.locator("#name").fill(nomeOriginal);
  await page
    .locator("textarea")
    .first()
    .fill("Você é a recepção de uma clínica. Atenda com educação e ajude a marcar consulta.");
  for (const id of ["model", "credential_id", "channel_session_id"]) {
    const gatilho = page.locator(`#${id}`);
    if ((await gatilho.count()) === 0) continue;
    await gatilho.click();
    await page.getByRole("option").first().click();
  }
  await page.getByRole("button", { name: /criar agente/i }).click();
  await page.waitForURL(/\/app\/ai\/agents\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // 2. Renomeia e salva.
  const nomeNovo = `${nomeOriginal} — renomeado`;
  const campoNome = page.locator("#name");
  await campoNome.waitFor({ state: "visible", timeout: 60_000 });
  await campoNome.fill(nomeNovo);
  const descartar = page.getByRole("button", { name: /descartar altera/i });
  await expect(descartar).toBeEnabled();
  await page.getByRole("button", { name: /salvar rascunho/i }).click();
  await expect(page.getByText(/altera(ç|c)(õ|o)es salvas/i).first()).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: path.join(EVIDENCIA, "01-renomeado-e-salvo.png"), fullPage: true });

  // 3. Recarrega: o nome novo está lá, e não há "alteração não salva" fantasma.
  await page.reload();
  await expect(page.locator("#name")).toHaveValue(nomeNovo, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /descartar altera/i })).toBeDisabled();

  // 4. E a lista mostra o nome novo, que é onde a pessoa procura depois.
  await page.goto("/app/ai/agents");
  await expect(page.getByText(nomeNovo).first()).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: path.join(EVIDENCIA, "02-lista-com-nome-novo.png"), fullPage: true });
});
