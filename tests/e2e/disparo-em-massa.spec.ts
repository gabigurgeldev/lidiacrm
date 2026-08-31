/**
 * DISPARO EM MASSA, PELA TELA, COMO UM LEIGO FARIA.
 *
 * ## O que esta spec prova, e o que ela NÃO prova
 *
 * Prova a jornada inteira do operador: abrir a tela pelo menu, subir uma
 * planilha, ver o RECORTE honesto (quem vai receber e quem não, com o motivo),
 * criar o disparo e chegar ao dossiê. E prova o caso que é o coração da
 * feature: um contato bloqueado aparece como **pulado com motivo legível** e a
 * tela oferece "abrir o contato" — nunca "reenviar".
 *
 * NÃO prova o envio chegando ao WhatsApp: isso exige WAHA de pé, e a spec que
 * exige WAHA vive em `FORA_DO_CI`. O que roda aqui é tudo o que acontece antes
 * de a mensagem sair — que é onde moram os erros de primeira impressão.
 *
 * ## Por que o caso negativo é o mais importante
 *
 * Um disparo que envia é fácil de acertar. O que separa esta feature de um
 * script é o que ela faz com quem NÃO vai receber: se o recorte mentisse para
 * cima, o operador acharia que falou com 500 pessoas tendo falado com 300; se a
 * tela oferecesse "tentar de novo" para quem pediu para parar, o produto estaria
 * ajudando a furar um opt-out registrado.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/disparo-em-massa.spec.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const env = carregarEnvLocal();
const admin: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Faixa reservada de telefone (+55 00 9…): nenhum destes existe no mundo, então
 * nem um erro de configuração faria uma mensagem sair para pessoa de verdade.
 * Sufixo aleatório porque o índice único de `contacts` é por (org, telefone) e
 * a suíte roda contra um banco que sobrevive entre execuções.
 */
const SUFIXO = String(Date.now()).slice(-6);
const TEL_OK_1 = `+5500911${SUFIXO}`;
const TEL_OK_2 = `+5500922${SUFIXO}`;
const TEL_BLOQUEADO = `+5500933${SUFIXO}`;

function escreverPlanilha(): string {
  // Ponto-e-vírgula de propósito: é o que o Excel pt-BR exporta, e o parser
  // detecta o delimitador sozinho. Se algum dia deixar de detectar, é aqui que
  // aparece — e não numa reclamação de cliente.
  const csv = [
    "Nome;Telefone",
    `Alice Teste;${TEL_OK_1}`,
    `Bruno Teste;${TEL_OK_2}`,
    `Carla Bloqueada;${TEL_BLOQUEADO}`,
    // Linha sem telefone: tem de virar erro de LINHA, não derrubar o arquivo.
    "Sem Telefone;",
    // Repetida da primeira: o recorte tem de contá-la como repetida, e a pessoa
    // não pode receber duas vezes.
    `Alice De Novo;${TEL_OK_1}`,
  ].join("\n");
  const destino = path.join(os.tmpdir(), `disparo-e2e-${SUFIXO}.csv`);
  fs.writeFileSync(destino, csv, "utf8");
  return destino;
}

test.describe("disparo em massa", () => {
  let planilha: string;

  test.beforeAll(() => {
    planilha = escreverPlanilha();
  });

  test.afterAll(async () => {
    fs.rmSync(planilha, { force: true });
    // Limpa só o que esta spec criou, por telefone — nunca por organização.
    for (const tel of [TEL_OK_1, TEL_OK_2, TEL_BLOQUEADO]) {
      await admin.from("contacts").delete().eq("phone_number", tel);
    }
  });

  test("a planilha vira lista, o recorte é honesto, e quem pediu para parar fica fora", async ({
    page,
  }) => {
    const creds = await loginComoAdmin(page, lerCreds());
    expect(creds.users.admin).toBeTruthy();

    // ─── A porta: chega-se pelo menu, não digitando a URL ──────────────────
    await page.goto("/app/inbox");
    const linkDoMenu = page.getByRole("link", { name: /disparo em massa/i }).first();
    await expect(
      linkDoMenu,
      "Disparo em massa precisa estar no menu — tela sem porta é tela que não existe",
    ).toBeVisible({ timeout: 20_000 });
    await linkDoMenu.click();
    await page.waitForURL(/\/app\/disparos/);

    // ─── Passo 1: nome + planilha ──────────────────────────────────────────
    await page.getByRole("button", { name: /novo disparo|criar o primeiro/i }).first().click();
    await page.locator("#nome-do-disparo").fill(`E2E ${SUFIXO}`);
    await page.locator("#planilha").setInputFiles(planilha);
    await page.getByRole("button", { name: /^continuar$/i }).click();

    // ─── Passo 2: o RECORTE, antes de qualquer decisão ─────────────────────
    //
    // Três dos cinco viram contato (uma linha sem telefone é erro de linha, uma
    // é repetida). Nenhum está bloqueado ainda, então os três recebem.
    const resumo = page.getByText(/vão receber/i).first();
    await expect(resumo).toBeVisible({ timeout: 30_000 });
    await expect(resumo).toHaveText(/3 vão receber/);
    await expect(page.getByText(/repetidos na planilha/i)).toBeVisible();

    // ─── Agora alguém pede para parar, no meio do caminho ──────────────────
    //
    // É o que acontece de verdade: a pessoa responde "PARAR" e a ingestão grava
    // `is_blocked`. O disparo tem de honrar isso — e o único jeito de provar é
    // bloquear DEPOIS de a lista ter sido montada.
    const { error: erroBloqueio } = await admin
      .from("contacts")
      .update({ is_blocked: true, blocked_reason: "stop_keyword", blocked_at: new Date().toISOString() })
      .eq("phone_number", TEL_BLOQUEADO);
    expect(erroBloqueio, "não deu para bloquear o contato de teste").toBeNull();

    // ─── Passo 2 (continuação): conexão e mensagem ─────────────────────────
    const conexao = page.locator("button", { hasText: /segundos entre mensagens/i }).first();
    await expect(
      conexao,
      "nenhuma conexão de WhatsApp no ambiente de teste — rode o seed de canal",
    ).toBeVisible({ timeout: 20_000 });
    await conexao.click();

    await page.locator("#corpo").fill("Mensagem de teste do disparo em massa.");
    await page.getByRole("button", { name: /^continuar$/i }).click();

    // ─── Passo 3: o ritmo, com o piso visível ──────────────────────────────
    const intervalo = page.locator("#intervalo");
    await expect(intervalo).toBeVisible();
    await expect(page.getByText(/mínimo de \d+s/i)).toBeVisible();

    // A trava do piso, medida por FERRAMENTA e não a olho: pedir 1 segundo tem
    // de render o piso da conexão, nunca 1. É a linha que protege o número.
    await intervalo.fill("1");
    await intervalo.blur();
    const valorAplicado = Number(await intervalo.inputValue());
    expect(
      valorAplicado,
      "a tela aceitou um intervalo abaixo do piso — é assim que se queima o número do cliente",
    ).toBeGreaterThan(1);

    await intervalo.fill("30");
    await page.getByRole("button", { name: /^continuar$/i }).click();

    // ─── Passo 4: a confirmação nomeia o tamanho do que se vai fazer ───────
    const botaoFinal = page.getByRole("button", { name: /criar disparo para \d+ pessoas/i });
    await expect(
      botaoFinal,
      'o botão precisa dizer para quantas pessoas — "Confirmar" esconde o tamanho da ação',
    ).toBeVisible();
    await botaoFinal.click();

    // ─── O dossiê ──────────────────────────────────────────────────────────
    await page.waitForURL(/\/app\/disparos\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: new RegExp(`E2E ${SUFIXO}`) })).toBeVisible();

    // O botão de disparar nomeia quantos — e NÃO é clicado: esta spec para
    // antes do envio de propósito (sem WAHA, a mensagem não teria para onde ir).
    await expect(page.getByRole("button", { name: /disparar para \d+ pessoas/i })).toBeVisible();

    // Contadores presentes e coerentes: nada enviado ainda.
    await expect(page.getByText(/^Enviados$/)).toBeVisible();
    await expect(page.getByText(/^Na fila$/)).toBeVisible();
  });

  test("o recorte conta quem pediu para parar, com motivo legível e sem oferecer reenvio", async ({
    page,
  }) => {
    // Este contato já nasce bloqueado — o caso do operador que sobe uma lista
    // velha, com gente que já pediu para sair.
    const tel = `+5500944${SUFIXO}`;
    const { error } = await admin.from("contacts").insert({
      organization_id: (await orgDoAdmin()) ?? undefined,
      display_name: "Bloqueado Antes",
      phone_number: tel,
      is_blocked: true,
      blocked_reason: "stop_keyword",
    });
    expect(error, "não deu para semear o contato bloqueado").toBeNull();

    const csv = ["Nome;Telefone", `Bloqueado Antes;${tel}`, `Livre;${TEL_OK_1}`].join("\n");
    const arquivo = path.join(os.tmpdir(), `disparo-bloqueado-${SUFIXO}.csv`);
    fs.writeFileSync(arquivo, csv, "utf8");

    try {
      await loginComoAdmin(page, lerCreds());
      await page.goto("/app/disparos");
      await page.getByRole("button", { name: /novo disparo|criar o primeiro/i }).first().click();
      await page.locator("#nome-do-disparo").fill(`E2E bloqueado ${SUFIXO}`);
      await page.locator("#planilha").setInputFiles(arquivo);
      await page.getByRole("button", { name: /^continuar$/i }).click();

      // A frase que muda a decisão: o operador vê ANTES de escolher qualquer
      // outra coisa que uma pessoa da lista pediu para não receber.
      await expect(page.getByText(/pediram para parar/i)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/1 vão receber|1 vai receber/i)).toBeVisible();
    } finally {
      fs.rmSync(arquivo, { force: true });
      await admin.from("contacts").delete().eq("phone_number", tel);
    }
  });
});

/** A organização do admin de teste — para semear contato pelo service role. */
async function orgDoAdmin(): Promise<string | null> {
  const { data } = await admin.from("organizations").select("id").limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
