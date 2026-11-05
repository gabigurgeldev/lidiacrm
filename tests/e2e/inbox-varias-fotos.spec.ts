import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

/**
 * VÁRIAS FOTOS DE UMA VEZ — pela tela, como a atendente escolhe as opções para
 * mandar ao cliente.
 *
 * ─── O que este arquivo cobre ───────────────────────────────────────────────
 *
 * 1. o seletor de "Fotos e vídeos" aceita várias e o preview mostra TODAS
 *    (antes só a primeira entrava e as outras sumiam sem aviso);
 * 2. a primeira carrega o selo "Com legenda" — a legenda vai só nela;
 * 3. o "x" de uma miniatura a tira do lote, e o título conta de novo;
 * 4. cancelar fecha sem enviar nada.
 *
 * Não cobre o envio até o WhatsApp: o ambiente do CI não tem sessão WAHA de pé,
 * e a rota recusa `channel_session_not_working`. A ordem, o ritmo e o que sobra
 * numa falha no meio são medidos em `tests/unit/composer-attach.test.tsx` e
 * `lib/inbox/enviar-lote.test.ts`.
 */

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
const EVIDENCE = path.join(process.cwd(), ".superpowers/evidence/inbox-varias-fotos");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const foto = (name: string) => ({ name, mimeType: "image/png", buffer: PNG_1X1 });

/** `agent`, nunca `admin` — ver o motivo em `inbox-responder-citando.spec.ts`. */
async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

/** Abre a primeira conversa; `false` quando o ambiente não tem nenhuma com campo liberado. */
async function abrirConversa(page: Page): Promise<boolean> {
  await page.goto("/app/inbox?filter=all");
  const primeira = page.locator("li, [role='listitem']").first();
  if (!(await primeira.count())) return false;
  await primeira.click();
  const campo = page.getByRole("textbox", { name: /Mensagem/i });
  const visivel = await campo
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  return visivel && (await campo.isEnabled());
}

test.describe("inbox — várias fotos de uma vez", () => {
  test("escolhe três, vê as três, tira uma e cancela", async ({ page }) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    await login(page, creds.users.agent!.email);
    const pronta = await abrirConversa(page);
    test.skip(!pronta, "ambiente sem conversa com o campo de resposta liberado");

    // O input vive escondido fora do menu (ver MenuDeOpcoes) — é nele que o
    // navegador entrega os arquivos que a pessoa escolheu na galeria.
    const seletor = page.locator('input[type="file"][accept^="image"]');
    await expect(seletor).toHaveAttribute("multiple", "");
    await seletor.setInputFiles([foto("opcao-1.png"), foto("opcao-2.png"), foto("opcao-3.png")]);

    // 1. o preview mostra as três
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Enviar 3 anexos")).toBeVisible();
    await expect(dialogo.locator("li img")).toHaveCount(3);
    // 2. o selo da legenda está na primeira
    await expect(dialogo.locator("li").first()).toContainText("Com legenda");
    await expect(dialogo.getByLabel("Legenda")).toHaveAttribute(
      "placeholder",
      "Legenda da primeira foto (opcional)",
    );
    await page.screenshot({ path: path.join(EVIDENCE, "1-tres-fotos.png") });

    // 3. tirar uma refaz a contagem do título
    await dialogo.getByRole("button", { name: "Remover opcao-2.png" }).click();
    await expect(dialogo.getByText("Enviar 2 anexos")).toBeVisible();
    await expect(dialogo.locator("li img")).toHaveCount(2);
    await page.screenshot({ path: path.join(EVIDENCE, "2-tirou-uma.png") });

    // 4. cancelar fecha sem enviar
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
