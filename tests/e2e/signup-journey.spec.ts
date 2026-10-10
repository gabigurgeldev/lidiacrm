/**
 * E2E — jornada completa de criação de conta (usuário real, browser real):
 *
 * 1. /login → clica "Criar conta"
 * 2. preenche o cadastro de uma tela só (nome, empresa, WhatsApp, e-mail,
 *    senha, aceite dos termos) e envia
 * 3. vê a tela "Falta só confirmar seu e-mail", abre o e-mail (Mailpit) e
 *    clica no link
 * 4. cai autenticado DIRETO no CRM — sem o assistente de onboarding
 * 5. sai e entra de novo com as credenciais criadas
 *
 * Pré-requisitos: Supabase local com Mailpit + app `next start` (ver README
 * da suíte / playwright.config.ts).
 */
import { test, expect } from "@playwright/test";

import { waitForEmail, extractAuthConfirmLink, uniqueEmail } from "./helpers/auth";

test("criar conta: cadastro → e-mail de confirmação → CRM → re-login", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("signup");
  const password = "SenhaForte!123";

  // 1. Login → botão "Criar conta"
  await page.goto("/login");
  await page.getByRole("link", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/signup$/);

  // 2. Cadastro de uma tela só
  await page.getByLabel("Seu nome").fill("Ana E2E");
  await page.getByLabel("Nome da empresa").fill("Loja E2E Signup");
  await page.getByLabel("WhatsApp").fill("11987654321");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByLabel(/Li e aceito os/).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: /Falta só confirmar seu e.mail/ })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/Spam/)).toBeVisible();

  // 3. Abre o e-mail real no Mailpit e segue o link
  const html = await waitForEmail(email, "Confirme seu e-mail");
  const link = extractAuthConfirmLink(html, baseURL!);
  await page.goto(link);

  // 4. Direto no CRM — organização criada, sem assistente
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/onboarding/);

  // 5. Sai (limpa sessão) e entra de novo com as credenciais criadas
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
});
