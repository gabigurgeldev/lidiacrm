/**
 * INBOX NO CELULAR, COMO O WHATSAPP — provado pela tela, num telefone de 390px.
 *
 * Reclamação do dono do produto (04/11/2026): "a navegação no celular é ruim
 * demais; quero o inbox parecido com o WhatsApp". O que esta spec prende:
 *
 *   1. a lista em tela cheia, com o título "Conversas" e a barra de abas embaixo
 *      (o cabeçalho do app some no Inbox, e o "Mais" é a porta da navegação);
 *   2. a conversa em tela cheia: ← + rosto + nome NUMA linha só, a barra de abas
 *      fora do caminho, o campo de escrever dentro da tela;
 *   3. o VOLTAR DO APARELHO devolve a lista (antes ele saía do Inbox);
 *   4. no toque, Enter quebra linha — o teclado do celular não tem Shift+Enter;
 *   5. nada rola de lado.
 *
 * Medidas por ferramenta (`getBoundingClientRect`), nunca a olho.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3021 pnpm exec playwright test tests/e2e/inbox-celular.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = path.join(process.cwd(), ".superpowers/evidence/inbox-celular");

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
const NOME_DO_CONTATO = `Celular Zap ${Date.now()}`;

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function captura(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`) });
}

async function semRolagemLateral(page: Page, onde: string): Promise<void> {
  const excesso = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(excesso, `${onde}: a página rola de lado`).toBeLessThanOrEqual(0);
}

test.describe("Inbox no celular (390px) — estilo WhatsApp", () => {
  test.describe.configure({ timeout: 180_000 });
  // `isMobile` + `hasTouch`: é o que faz `(pointer: coarse)` casar, como num
  // telefone de verdade — sem isso o Enter seguiria a regra do computador.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
          waha_session_name: `e2e-celular-${Date.now()}`,
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
        phone_number: `+55119${String(Date.now()).slice(-8)}`,
      })
      .select("id")
      .single();
    if (erroContato) throw new Error(`contacts: ${erroContato.message}`);

    // Sem dono e aberta: está na Fila, que o atendente vê no modo padrão.
    const { data: conversa, error: erroConversa } = await admin
      .from("conversations")
      .insert({
        organization_id: creds.org_id,
        contact_id: (contato as { id: string }).id,
        channel_session_id: sessaoId,
        status: "open",
        last_message_preview: "Oi, vocês entregam hoje?",
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (erroConversa) throw new Error(`conversations: ${erroConversa.message}`);
    conversaId = (conversa as { id: string }).id;
  });

  test("lista em tela cheia, conversa em tela cheia, voltar do aparelho devolve a lista", async ({
    page,
  }) => {
    const atendente = creds.users.agent!;
    await login(page, atendente.email, creds.password);

    // (1) A LISTA. Cabeçalho do app escondido; título e barra de abas à vista.
    await page.goto("/app/inbox?filter=unassigned");
    await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("cabecalho-do-app")).toBeHidden();
    const barra = page.getByTestId("barra-inferior");
    await expect(barra).toBeVisible();
    await expect(barra.getByRole("link", { name: "Conversas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // A barra encosta no pé da tela (nada flutuando nem cortado).
    const caixaDaBarra = await barra.boundingBox();
    expect(caixaDaBarra, "barra de abas sem caixa").not.toBeNull();
    expect(Math.round(caixaDaBarra!.y + caixaDaBarra!.height)).toBeLessThanOrEqual(844);
    expect(Math.round(caixaDaBarra!.y + caixaDaBarra!.height)).toBeGreaterThanOrEqual(840);
    await semRolagemLateral(page, "lista");
    await captura(page, "1-lista");

    // (2) ABRE A CONVERSA pelo toque na lista.
    await page.getByText(NOME_DO_CONTATO).first().click();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${conversaId}`));
    const cabecalho = page.getByTestId("cabecalho-da-conversa");
    await expect(cabecalho).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Conversas" })).toBeHidden();
    await expect(barra).toHaveCount(0);

    // ← + rosto + nome numa linha só: o cabeçalho tem a altura de UMA linha.
    const voltar = cabecalho.getByTestId("voltar-para-conversas");
    await expect(voltar).toBeVisible();
    const caixaDoCabecalho = await cabecalho.boundingBox();
    expect(caixaDoCabecalho!.height, "cabeçalho da conversa quebrou em duas linhas").toBeLessThanOrEqual(64);
    // E o ← e o nome estão DENTRO dessa linha (não é uma barra extra em cima).
    const caixaDoVoltar = await voltar.boundingBox();
    const caixaDoNome = await cabecalho.getByRole("heading", { name: NOME_DO_CONTATO }).boundingBox();
    for (const [nome, caixa] of [
      ["←", caixaDoVoltar],
      ["nome do contato", caixaDoNome],
    ] as const) {
      expect(caixa!.y, `${nome} acima do cabeçalho`).toBeGreaterThanOrEqual(caixaDoCabecalho!.y - 1);
      expect(caixa!.y + caixa!.height, `${nome} abaixo do cabeçalho`).toBeLessThanOrEqual(
        caixaDoCabecalho!.y + caixaDoCabecalho!.height + 1,
      );
    }

    // O campo de escrever está DENTRO da tela.
    const campo = page.getByRole("textbox", { name: "Mensagem" });
    await expect(campo).toBeVisible();
    const caixaDoCampo = await campo.boundingBox();
    expect(caixaDoCampo!.y + caixaDoCampo!.height).toBeLessThanOrEqual(844);
    await semRolagemLateral(page, "conversa aberta");
    await captura(page, "2-conversa-aberta");

    // (3) NO TOQUE, ENTER QUEBRA LINHA — e nada é enviado.
    await campo.click();
    await campo.pressSequentially("primeira linha");
    await campo.press("Enter");
    await campo.pressSequentially("segunda linha");
    await expect(campo).toHaveValue("primeira linha\nsegunda linha");
    await campo.fill("");

    // (4) O VOLTAR DO APARELHO devolve a lista — e não sai do Inbox.
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/inbox(?!.*[?&]id=)/);
    await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible();
    await expect(barra).toBeVisible();
    await captura(page, "3-voltou-pelo-aparelho");

    // (5) E o ← da tela faz o mesmo.
    await page.getByText(NOME_DO_CONTATO).first().click();
    await expect(cabecalho).toBeVisible({ timeout: 30_000 });
    await cabecalho.getByTestId("voltar-para-conversas").click();
    await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/inbox(?!.*[?&]id=)/);

    // (6) "Mais" abre a navegação completa.
    await page.getByTestId("barra-inferior-mais").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await semRolagemLateral(page, "gaveta aberta");
    await captura(page, "4-mais-abre-a-navegacao");
  });
});
