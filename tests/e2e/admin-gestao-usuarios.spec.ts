/**
 * QUEM ADMINISTRA A INSTALAÇÃO GERENCIA AS CONTAS PELO PAINEL — pela tela.
 *
 * Jornada J28 de `docs/testing/user-journey-map.md`. Antes desta entrega o
 * painel `/admin` listava usuários e não fazia nada com eles, e não havia porta
 * do app até ele. O que se prova aqui é a cadeia que uma pessoa percorre:
 *
 *   1. a PORTA — o dono do servidor vê "Admin da plataforma" no app; o admin de
 *      uma organização não vê, e digitar `/admin` o manda para `/admin/forbidden`;
 *   2. CRIAR — "Novo usuário" cria uma conta que aparece na lista;
 *   3. SUSPENDER — a conta suspensa NÃO consegue entrar (login real, outro
 *      navegador), e reativar devolve o acesso ao estado ativo;
 *   4. PAPEL e REMOVER DA ORG — pelo detalhe e pelo menu da linha;
 *   5. EXCLUIR — com o e-mail digitado; some da busca;
 *   6. RELATÓRIO e CSV — os números aparecem e o arquivo baixa com o cabeçalho.
 *
 * Quem é quem: `e2e-dono@deskcomm.test` é platform admin; `e2e-admin@deskcomm.test`
 * é admin de TENANT e não de plataforma (`scripts/seed-e2e-system-update.ts`
 * revoga a promoção dele). Os dois entram por `/login/mfa` — ver o cabeçalho de
 * `marca-logo.spec.ts` para o porquê.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { generateTotp, msUntilNextTotpWindow } from "./utils/totp";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = path.join(process.cwd(), "evidence", "admin-gestao-usuarios");

interface E2ECreds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
  admin_totp?: { factor_id: string; secret: string };
  dono_totp?: { factor_id: string; secret: string };
}

function loadCreds(): E2ECreds {
  const precisaSemear = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
    return !c.users?.dono || !c.admin_totp?.secret || !c.dono_totp?.secret || !c.org_id;
  };
  if (precisaSemear()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  execFileSync("npx", ["tsx", "scripts/seed-e2e-system-update.ts"], { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
}

const creds = loadCreds();

async function evidencia(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function loginComTotp(page: Page, email: string, secret: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click({ timeout: 15_000 });
  await page.waitForURL(/\/login\/mfa/);

  const digito1 = page.locator('input[aria-label="Dígito 1"]');
  const recusa = page.locator("form").getByRole("alert");

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (msUntilNextTotpWindow() < 3_000) await page.waitForTimeout(msUntilNextTotpWindow() + 200);
    await digito1.click({ timeout: 15_000 });
    await page.keyboard.type(generateTotp(secret), { delay: 40 });
    const desfecho = await Promise.race([
      page.waitForURL(/\/app\//, { timeout: 60_000 }).then(
        () => "entrou" as const,
        () => "sem-desfecho" as const,
      ),
      recusa.waitFor({ state: "visible", timeout: 60_000 }).then(
        () => "recusado" as const,
        () => "sem-desfecho" as const,
      ),
    ]);
    if (desfecho === "entrou") return;
    if (desfecho === "sem-desfecho") {
      throw new Error(`o desafio de MFA de ${email} não terminou em 60s (url=${page.url()})`);
    }
    await page.waitForTimeout(msUntilNextTotpWindow() + 200);
  }
  throw new Error(`MFA falhou depois de 2 tentativas para ${email} (url=${page.url()})`);
}

/** A linha da lista cujo e-mail é este — busca pelo campo, como a pessoa faria. */
async function buscar(page: Page, email: string): Promise<void> {
  await page.getByRole("textbox", { name: "Buscar usuários" }).fill(email);
}

test.describe.configure({ mode: "serial" });

test.describe("J28 — gestão de usuários pelo painel da plataforma", () => {
  const novoEmail = `e2e-gestao-${Date.now()}@deskcomm.test`;
  const novaSenha = "senha-e2e-gestao-123";
  let novoId = "";

  test("admin de ORGANIZAÇÃO não vê a porta e é barrado no /admin", async ({ page }) => {
    await loginComTotp(page, creds.users.admin!.email, creds.admin_totp!.secret);
    await expect(page.getByTestId("acoes-de-conta-na-barra")).toBeVisible();
    await expect(page.getByTestId("porta-do-admin")).toHaveCount(0);

    await page.goto("/admin/users");
    await page.waitForURL(/\/admin\/forbidden/);
    await evidencia(page, "01-admin-de-org-barrado");
  });

  test("dono do servidor entra pelo botão, cria, suspende, reativa, muda papel, remove e exclui", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);

    // 1. A porta
    const porta = page.getByTestId("porta-do-admin").getByRole("link");
    await expect(porta).toBeVisible();
    await porta.click();
    await page.waitForURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("resumo-de-usuarios")).toBeVisible();
    await evidencia(page, "02-dashboard-com-resumo");

    // 2. Criar
    await page.getByRole("link", { name: "Usuários", exact: true }).first().click();
    await page.waitForURL(/\/admin\/users$/);
    await page.getByTestId("novo-usuario").click();
    await page.getByTestId("novo-usuario-email").fill(novoEmail);
    await page.getByTestId("novo-usuario-nome").fill("Pessoa E2E Gestão");
    await page.getByTestId("novo-usuario-senha").fill(novaSenha);
    await page.getByTestId("novo-usuario-org").click();
    await page.getByRole("option").first().click();
    await page.getByTestId("novo-usuario-salvar").click();
    await expect(page.getByText("Usuário criado.", { exact: false })).toBeVisible();

    await buscar(page, novoEmail);
    const linha = page.getByRole("row").filter({ hasText: novoEmail });
    await expect(linha).toHaveCount(1);
    await evidencia(page, "03-usuario-criado");

    const menu = linha.getByRole("button", { name: "Ações do usuário" });
    const testId = await menu.getAttribute("data-testid");
    novoId = (testId ?? "").replace("acoes-usuario-", "");
    expect(novoId).toMatch(/^[0-9a-f-]{36}$/);

    // 3. Suspender — e provar que a pessoa não entra
    await menu.click();
    await page.getByTestId("acao-suspender").click();
    await page.getByTestId("suspender-motivo").fill("Teste E2E da jornada J28 de gestão");
    await page.getByTestId("suspender-confirmar").click();
    await expect(linha.getByText("Suspenso")).toBeVisible();
    await evidencia(page, "04-suspenso-na-lista");

    const outro = await browser.newContext();
    const pSuspenso = await outro.newPage();
    await pSuspenso.goto("/login");
    await pSuspenso.locator("#email").fill(novoEmail);
    await pSuspenso.locator("#password").fill(novaSenha);
    await pSuspenso.getByRole("button", { name: /entrar/i }).click();
    await pSuspenso.waitForTimeout(3_000);
    expect(pSuspenso.url()).toMatch(/\/login/);
    await evidencia(pSuspenso, "05-suspenso-nao-entra");
    await outro.close();

    // Reativar
    await menu.click();
    await page.getByTestId("acao-reativar").click();
    await expect(linha.getByText("Suspenso")).toHaveCount(0);

    // 4. Papel pelo detalhe
    await linha.getByRole("link", { name: "Ver" }).click();
    await page.waitForURL(new RegExp(`/admin/users/${novoId}`));
    await page.getByRole("combobox", { name: "Papel nesta organização" }).first().click();
    await page.getByRole("option", { name: "Gerente" }).click();
    await expect(page.getByText("Papel atualizado.")).toBeVisible();
    await evidencia(page, "06-papel-trocado");

    // Remover da organização
    await page.getByRole("button", { name: "Remover", exact: true }).first().click();
    await page.getByTestId("remover-da-org-confirmar").click();
    await expect(page.getByText("Pessoa removida da organização.")).toBeVisible();

    // 5. Excluir
    await page.getByRole("button", { name: "Ações do usuário" }).click();
    await page.getByTestId("acao-excluir").click();
    await expect(page.getByTestId("excluir-confirmar")).toBeDisabled();
    await page.getByTestId("excluir-confirmacao").fill(novoEmail);
    await page.getByTestId("excluir-confirmar").click();
    await page.waitForURL(/\/admin\/users$/);
    await buscar(page, novoEmail);
    await expect(page.getByText("Nenhum usuário encontrado")).toBeVisible();
    await evidencia(page, "07-excluido");
  });

  test("relatório mostra números e o CSV baixa com o cabeçalho", async ({ page }) => {
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);
    await page.goto("/admin/users/relatorios");
    const total = page.getByTestId("kpi-usuarios");
    await expect(total).toBeVisible();
    const n = Number((await total.locator("p").nth(1).innerText()).replace(/\D/g, ""));
    expect(n).toBeGreaterThan(0);
    await evidencia(page, "08-relatorio");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar CSV" }).click(),
    ]);
    const conteudo = fs.readFileSync((await download.path())!, "utf8");
    expect(conteudo.replace(/^﻿/, "").split("\r\n")[0]).toBe(
      "id,email,nome,status,organizacoes,criado_em,ultimo_acesso,email_confirmado,mfa",
    );
  });
});
