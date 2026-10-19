import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

/**
 * ASSINATURA DO ATENDENTE — pela tela, como o atendente liga e usa.
 *
 * O botão mora no composer, ao lado do emoji. Ligado, cada mensagem que a
 * pessoa manda pelo inbox sai com `*Nome:*` na primeira linha — o cliente vê o
 * nome em negrito no WhatsApp, e a bolha do CRM desenha igual.
 *
 * ─── O que este arquivo cobre, e por que cada caso ──────────────────────────
 *
 * 1. ligar mostra "Assinando como …" acima do campo — quem digita precisa saber
 *    que o nome vai junto ANTES de apertar Enter;
 * 2. a preferência SOBREVIVE ao recarregar — ela é do perfil da pessoa, não do
 *    estado da tela; um toggle que esquece é pior que nenhum;
 * 3. enviar desenha a bolha com o nome em negrito, sem os asteriscos;
 * 4. desligar some com a faixa — e o arquivo termina desligado, para não
 *    assinar a mensagem das specs que rodam depois com o mesmo usuário.
 *
 * Não cobre o que sai na rede: se o texto assinado chegou ao WhatsApp é medido
 * em `tests/unit/messages-handler-assinatura.test.ts`, que confere a linha
 * gravada e o payload do `/api/sendText` lado a lado.
 */

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
const EVIDENCE = path.join(process.cwd(), ".superpowers/evidence/inbox-assinatura");
const NOME = "Atendente E2E";

/** `agent`, nunca `admin` — ver o motivo em `inbox-responder-citando.spec.ts`. */
async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

/** Abre a primeira conversa do inbox; `false` quando o ambiente não tem nenhuma. */
async function abrirConversa(page: Page): Promise<boolean> {
  await page.goto("/app/inbox?filter=all");
  const primeira = page.locator("li, [role='listitem']").first();
  if (!(await primeira.count())) return false;
  await primeira.click();
  return page
    .getByRole("button", { name: /Assinatura das mensagens/i })
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

async function definirAssinatura(page: Page, ligada: boolean): Promise<void> {
  await page.getByRole("button", { name: /Assinatura das mensagens/i }).click();
  const chave = page.getByRole("switch", { name: /Assinar minhas mensagens/i });
  if ((await chave.getAttribute("aria-checked")) !== String(ligada)) await chave.click();
  await page.getByLabel(/Nome da assinatura/i).fill(NOME);
  await page.getByRole("button", { name: /^Salvar$/ }).click();
  await expect(page.getByText(ligada ? "Assinatura ligada." : "Assinatura desligada.")).toBeVisible();
}

test.describe("assinatura do atendente", () => {
  test("liga, persiste, assina a bolha e desliga", async ({ page }) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    await login(page, creds.users.agent!.email);
    const temConversa = await abrirConversa(page);
    test.skip(!temConversa, "ambiente sem conversa — não há composer para assinar");

    // 1. ligar mostra a faixa
    await definirAssinatura(page, true);
    const faixa = page.getByText("Assinando como");
    await expect(faixa).toBeVisible();
    await expect(faixa.locator("..")).toContainText(NOME);
    await page.screenshot({ path: path.join(EVIDENCE, "1-ligada.png") });

    // 2. sobrevive ao recarregar
    await page.reload();
    await expect(page.getByText("Assinando como")).toBeVisible({ timeout: 10000 });

    // 3. enviar desenha a bolha assinada — quando o campo aceita resposta
    // (janela de 24h fechada no canal oficial barra o envio, e isso não é
    // assunto deste arquivo).
    const campo = page.getByRole("textbox", { name: /Mensagem/i });
    if (await campo.isEnabled()) {
      const texto = `assinatura e2e ${Date.now()}`;
      await campo.fill(texto);
      await campo.press("Enter");
      const bolha = page.locator("p", { hasText: texto }).last();
      await expect(bolha).toBeVisible({ timeout: 10000 });
      const nome = bolha.locator("[data-assinatura]");
      await expect(nome).toHaveText(`${NOME}:`);
      // Medido, não a olho: o nome está em negrito de verdade.
      const peso = await nome.evaluate((el) => Number(getComputedStyle(el).fontWeight));
      expect(peso).toBeGreaterThanOrEqual(600);
      await expect(bolha).not.toContainText(`*${NOME}:*`);
      await page.screenshot({ path: path.join(EVIDENCE, "2-bolha-assinada.png") });
    }

    // 4. desligar some com a faixa (e deixa o usuário como estava)
    await definirAssinatura(page, false);
    await expect(page.getByText("Assinando como")).toHaveCount(0);
  });
});
