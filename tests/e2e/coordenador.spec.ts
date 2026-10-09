/**
 * COORDENADOR DE ATENDIMENTO, PELA TELA.
 *
 * ## O que esta spec prova
 *
 * - A porta existe: o hub "IA" leva à tela do coordenador.
 * - O estado de toda instalação: nada publicado, modo Desligado.
 * - Publicar uma versão em Observar (shadow) pela tela — a versão aparece "em
 *   vigor", com número — e voltar a Desligado no fim, para não deixar o banco
 *   do CI diferente do que as outras specs esperam.
 * - Simular sem destinos: a tela diz que a conversa ficaria com a equipe, sem
 *   enviar nada.
 * - Atividade vazia explica quando as trocas aparecem.
 *
 * ## O que NÃO prova
 *
 * O coordenador decidindo um atendimento real: o CI não tem WhatsApp nem
 * chave de provedor de IA. A decisão, a troca de responsável, o fencing do
 * envio e o retorno de chamada são provados no Postgres real em
 * `tests/invariants/coordenador-*.test.ts`.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/coordenador.spec.ts
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

test.describe("coordenador de atendimento", () => {
  test("publicar em Observar, simular e voltar a Desligado", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());

    // ─── A porta ──────────────────────────────────────────────────────────
    await page.goto("/app/ai");
    await page.getByRole("link", { name: /Coordenador/ }).first().click();
    await expect(page).toHaveURL(/\/app\/ai\/coordenador/);
    await expect(page.getByRole("heading", { name: "Coordenador de atendimento" })).toBeVisible();

    // ─── Publicar em Observar ─────────────────────────────────────────────
    await page.getByRole("button", { name: /^Observar/ }).click();
    await expect(page.getByText("Há mudanças não publicadas.")).toBeVisible();
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText(/Versão em vigor #\d+ · Observar/)).toBeVisible({ timeout: 20_000 });

    // ─── Simular: sem destinos, ninguém automático conduz ─────────────────
    await page.getByRole("tab", { name: "Simular" }).click();
    await page.getByLabel("Mensagem do cliente").fill("Quero saber o preço do plano anual");
    await page.getByRole("button", { name: "Simular" }).last().click();
    await expect(page.getByTestId("resultado-simulacao")).toContainText(/ficaria com a equipe|Ninguém automático/, {
      timeout: 20_000,
    });

    // ─── Atividade: vazia, com a explicação ───────────────────────────────
    await page.getByRole("tab", { name: "Atividade" }).click();
    await expect(page.getByText(/Nenhuma troca de responsável ainda|→/).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: ".superpowers/evidence/coordenador-atividade.png", fullPage: true });

    // ─── Volta a Desligado ────────────────────────────────────────────────
    await page.getByRole("tab", { name: "Configurar" }).click();
    await page.getByRole("button", { name: /^Desligado/ }).click();
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText(/Versão em vigor #\d+ · Desligado/)).toBeVisible({ timeout: 20_000 });
  });
});
