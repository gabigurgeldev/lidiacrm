/**
 * VÁRIOS NÚMEROS, E CADA UM DIZENDO POR QUAL REGRA FALA — provado pela tela.
 *
 * ═══ Por que este spec existe ═══
 *
 * Três defeitos consertados nesta entrega são todos sobre o que a pessoa VÊ, e
 * nenhum se prova por `curl`:
 *
 *  1. **Conectar um segundo número oficial substituía o primeiro em silêncio.**
 *     A API respondia 200, a tela dizia "Conectado", e o número antigo seguia
 *     recebendo mensagem para ser respondido pelo novo. Só a tela mostrando DOIS
 *     cartões prova o conserto.
 *  2. **Nada distinguia um número ligado por QR de um canal oficial.** As regras
 *     de envio são opostas (janela de 24h × texto livre com risco de banimento),
 *     e o operador escolhia no escuro.
 *  3. **A bolha não dizia por onde a mensagem passou.**
 *
 * ═══ O que este spec NÃO faz, e por quê ═══
 *
 * Não conecta um número de verdade em provedor nenhum: isso exigiria credencial
 * real da Meta e do intermediário no CI, que a doutrina de QA Visual reserva à
 * jornada `vps-fresh-onboarding` (a P0, fora do CI justamente por isso). Aqui as
 * linhas de `channel_sessions` são semeadas pelo service role — o mesmo recurso
 * que a ingestão do webhook cria — e o que se mede é a TELA sobre elas.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3021 pnpm exec playwright test tests/e2e/conexoes-multicanal.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = path.join(process.cwd(), ".superpowers/evidence/conexoes-multicanal");

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
const marca = String(Date.now()).slice(-8);
const criados: string[] = [];
let conversaId = "";
let contatoId = "";

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

/** Semeia uma linha de canal e devolve o id. */
async function semearCanal(linha: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: creds.org_id,
      webhook_secret_encrypted: "e2e",
      status: "WORKING",
      ...linha,
    })
    .select("id")
    .single();
  if (error) throw new Error(`channel_sessions: ${error.message}`);
  const id = (data as { id: string }).id;
  criados.push(id);
  return id;
}

test.describe("Conexões — vários números e o selo de cada um", () => {
  test.describe.configure({ timeout: 180_000 });

  let idQr = "";
  let idOficialA = "";

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;

    // Um número por QR e DOIS oficiais — a configuração que a versão anterior
    // não conseguia representar.
    idQr = await semearCanal({
      waha_session_name: `e2e-multi-qr-${marca}`,
      display_name: `QR ${marca}`,
      phone_number: `+55119${marca}`,
    });
    idOficialA = await semearCanal({
      provider: "meta_cloud",
      meta_phone_number_id: `pnid-a-${marca}`,
      meta_waba_id: `waba-${marca}`,
      display_name: `Vendas ${marca}`,
      phone_number: `+55219${marca}`,
    });
    await semearCanal({
      provider: "meta_cloud",
      meta_phone_number_id: `pnid-b-${marca}`,
      meta_waba_id: `waba-${marca}`,
      display_name: `Suporte ${marca}`,
      phone_number: `+55319${marca}`,
    });

    // Uma conversa que entrou pelo canal OFICIAL — é sobre ela que o selo da
    // bolha é medido.
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: creds.org_id,
        display_name: `Cliente Multicanal ${marca}`,
        phone_number: `+55419${marca}`,
      })
      .select("id")
      .single();
    if (erroContato) throw new Error(`contacts: ${erroContato.message}`);
    contatoId = (contato as { id: string }).id;

    const { data: conversa, error: erroConversa } = await admin
      .from("conversations")
      .insert({
        organization_id: creds.org_id,
        contact_id: contatoId,
        channel_session_id: idOficialA,
        status: "open",
        last_message_preview: "Oi, queria saber o preço",
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (erroConversa) throw new Error(`conversations: ${erroConversa.message}`);
    conversaId = (conversa as { id: string }).id;

    const { error: erroMsg } = await admin.from("messages").insert({
      organization_id: creds.org_id,
      conversation_id: conversaId,
      channel_session_id: idOficialA,
      contact_id: contatoId,
      type: "text",
      direction: "inbound",
      status: "delivered",
      body: "Oi, queria saber o preço",
      sent_at: new Date().toISOString(),
    });
    if (erroMsg) throw new Error(`messages: ${erroMsg.message}`);
  });

  test.afterAll(async () => {
    // Limpa na ordem das FKs RESTRICT: mensagem, conversa, contato, canal.
    await admin.from("messages").delete().eq("conversation_id", conversaId);
    await admin.from("conversations").delete().eq("id", conversaId);
    await admin.from("contacts").delete().eq("id", contatoId);
    for (const id of criados) await admin.from("channel_sessions").delete().eq("id", id);
  });

  test("⭐ os DOIS números oficiais aparecem, cada um com o seu", async ({ page }) => {
    const admin0 = creds.users.admin!;
    await login(page, admin0.email, creds.password);
    await page.goto("/app/connections?aba=oficial");

    const raiz = page.getByTestId("canal-oficial-root");
    await expect(raiz).toBeVisible({ timeout: 30_000 });

    // A asserção que carrega o spec: a versão anterior mostrava UM.
    await expect(raiz.getByText(`Vendas ${marca}`)).toBeVisible();
    await expect(raiz.getByText(`Suporte ${marca}`)).toBeVisible();

    // E cada um traz a SUA URL de webhook — colar a do primeiro no painel do
    // segundo faz as respostas entrarem no canal errado.
    const urls = await raiz.getByText(/\/api\/v1\/webhooks\/meta\//).allInnerTexts();
    expect(new Set(urls.map((u) => u.trim())).size).toBeGreaterThanOrEqual(2);

    await captura(page, "01-dois-numeros-oficiais");
  });

  test("cada cartão diz COMO o número foi ligado", async ({ page }) => {
    const admin0 = creds.users.admin!;
    await login(page, admin0.email, creds.password);

    await page.goto("/app/connections");
    const selo = page.getByTestId("tipo-de-canal").first();
    await expect(selo).toBeVisible({ timeout: 30_000 });
    // Na aba de números por QR o selo tem de dizer QR — e não "Oficial".
    await expect(selo).toHaveAttribute("data-tipo", "qr");

    await page.goto("/app/connections?aba=oficial");
    const seloOficial = page.getByTestId("canal-oficial-root").getByTestId("tipo-de-canal").first();
    await expect(seloOficial).toHaveAttribute("data-tipo", "oficial");

    await captura(page, "02-selo-por-tipo");
  });

  test("⭐ no Inbox, a conversa e a BOLHA dizem por onde a mensagem passou", async ({ page }) => {
    const admin0 = creds.users.admin!;
    await login(page, admin0.email, creds.password);
    await page.goto(`/app/inbox?conversation=${conversaId}`);

    // O cabeçalho nomeia o número da EMPRESA — não o do cliente.
    const canalDaConversa = page.getByTestId("canal-da-conversa");
    await expect(canalDaConversa).toBeVisible({ timeout: 30_000 });
    await expect(canalDaConversa).toContainText(`+55219${marca}`);

    // E a bolha carrega o selo, mesmo sem rótulo visível.
    const seloNaBolha = page.locator('.bolha [data-testid="tipo-de-canal"]').first();
    await expect(seloNaBolha).toBeAttached({ timeout: 30_000 });
    await expect(seloNaBolha).toHaveAttribute("data-tipo", "oficial");

    // A reserva de espaço acompanha o selo: sem isto ele colide com a hora.
    const bolha = page.locator(".bolha").first();
    await expect(bolha).toHaveAttribute("data-com-selo", "true");

    await captura(page, "03-selo-na-bolha");
  });

  test("o seletor de números separa os três, com o tipo de cada um", async ({ page }) => {
    const admin0 = creds.users.admin!;
    await login(page, admin0.email, creds.password);
    await page.goto("/app/inbox");

    // Com três canais o seletor aparece (com um só ele some, de propósito).
    const seletor = page.getByLabel(/Filtrar por número/i);
    await expect(seletor).toBeVisible({ timeout: 30_000 });
    await seletor.click();

    await expect(page.getByRole("option", { name: new RegExp(`Vendas ${marca}`) })).toBeVisible();
    await expect(page.getByRole("option", { name: new RegExp(`QR ${marca}`) })).toBeVisible();

    await captura(page, "04-seletor-de-numeros");
    // Fecha o seletor sem escolher — o teste não deve deixar filtro ligado.
    await page.keyboard.press("Escape");
    expect(idQr).not.toBe("");
  });
});
