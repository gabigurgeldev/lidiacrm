/**
 * FECHAR E REABRIR — provado pela tela, como o atendente faz.
 *
 * Fechar ficava escondido no ⋮ e era porta só de ida: a conversa fechada não
 * tinha ação de volta para quem não era o dono. Agora "Fechar" está à vista no
 * cabeçalho, e a fechada oferece "Reabrir", que pergunta para qual aba ela volta.
 *
 * Cada passo confere o BANCO além da tela: o que se vende é a conversa mudar de
 * estado, não o botão mudar de nome.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3021 pnpm exec playwright test tests/e2e/inbox-fechar-e-reabrir.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = path.join(process.cwd(), ".superpowers/evidence/inbox-fechar-e-reabrir");

interface Creds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let creds: Creds;
let conversaId = "";
const NOME_DO_CONTATO = `Fecha Reabre ${Date.now()}`;

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function captura(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function noBanco(): Promise<{ status: string; assigned_to_user_id: string | null }> {
  const { data, error } = await admin
    .from("conversations")
    .select("status, assigned_to_user_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (error || !data) throw new Error(`leitura da conversa falhou: ${error?.message}`);
  return data as { status: string; assigned_to_user_id: string | null };
}

test.describe("Inbox — fechar e reabrir uma conversa", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;

    const { data: sessaoExistente } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", creds.org_id)
      .limit(1)
      .maybeSingle();
    let sessaoId = (sessaoExistente as { id: string } | null)?.id ?? null;
    if (!sessaoId) {
      const { data, error } = await admin
        .from("channel_sessions")
        .insert({
          organization_id: creds.org_id,
          waha_session_name: `e2e-fecha-reabre-${Date.now()}`,
          webhook_secret_encrypted: "e2e",
        })
        .select("id")
        .single();
      if (error) throw new Error(`channel_sessions: ${error.message}`);
      sessaoId = (data as { id: string }).id;
    }

    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: creds.org_id,
        display_name: NOME_DO_CONTATO,
        phone_number: `+55118${String(Date.now()).slice(-8)}`,
      })
      .select("id")
      .single();
    if (erroContato) throw new Error(`contacts: ${erroContato.message}`);

    const { data: conversa, error: erroConversa } = await admin
      .from("conversations")
      .insert({
        organization_id: creds.org_id,
        contact_id: (contato as { id: string }).id,
        channel_session_id: sessaoId,
        status: "open",
        last_message_preview: "Obrigado, era só isso",
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (erroConversa) throw new Error(`conversations: ${erroConversa.message}`);
    conversaId = (conversa as { id: string }).id;
  });

  test("fecha pelo botão à vista, reabre em Minhas, fecha de novo e reabre na Fila", async ({
    page,
  }) => {
    const atendente = creds.users.agent!;
    await login(page, atendente.email, creds.password);
    // "Fechar esta conversa?" é um confirm() nativo — a pessoa clica OK.
    page.on("dialog", (d) => void d.accept());

    // (1) Aberta: "Fechar" está na barra, sem abrir menu nenhum.
    await page.goto(`/app/inbox/${conversaId}`);
    const fechar = page.getByTestId("fechar-conversa");
    await expect(fechar).toBeVisible({ timeout: 30_000 });
    // O CONTROLE: aberta não oferece "Reabrir".
    await expect(page.getByTestId("reabrir-conversa")).toHaveCount(0);
    await captura(page, "1-aberta-com-fechar-a-vista");

    // (2) Fecha.
    await fechar.click();
    const reabrir = page.getByTestId("reabrir-conversa");
    await expect(reabrir).toBeVisible({ timeout: 30_000 });
    await expect(fechar).toHaveCount(0);
    // Fechada SEM dono não oferece mais "Assumir" — era a volta por efeito colateral.
    await expect(page.getByRole("button", { name: /^Assumir$/i })).toHaveCount(0);
    await expect.poll(async () => (await noBanco()).status).toBe("closed");
    await captura(page, "2-fechada-com-reabrir");

    // (3) Reabre em Minhas: assume, e a inbox vai para a aba Minhas.
    await reabrir.click();
    await page.getByTestId("reabrir-em-minhas").click();
    await expect(page).toHaveURL(/filter=mine/, { timeout: 30_000 });
    await expect.poll(async () => noBanco()).toEqual({
      status: "claimed",
      assigned_to_user_id: atendente.id,
    });
    await expect(page.getByTestId("fechar-conversa")).toBeVisible();
    await captura(page, "3-reaberta-em-minhas");

    // (4) Fecha de novo e reabre na Fila: sem dono, aberta, aba Fila.
    await page.getByTestId("fechar-conversa").click();
    await expect(page.getByTestId("reabrir-conversa")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await noBanco()).status).toBe("closed");
    await page.getByTestId("reabrir-conversa").click();
    await page.getByTestId("reabrir-na-fila").click();
    await expect(page).toHaveURL(/filter=unassigned/, { timeout: 30_000 });
    await expect.poll(async () => noBanco()).toEqual({
      status: "open",
      assigned_to_user_id: null,
    });
    await captura(page, "4-reaberta-na-fila");
  });
});
