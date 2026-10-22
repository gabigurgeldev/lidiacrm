import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { escolherDiaDesenhado, irParaASemanaSeguinte } from "./helpers/agenda-semana-integra";

/**
 * AGENDA COM PROFISSIONAIS (migration 0245) — pela tela, como a recepção usaria.
 *
 * Três jornadas, na ordem em que uma clínica recém-atualizada as encontra:
 *
 *   1. Cadastrar a profissional SEM LOGIN — o caso que motivou a feature —, dar
 *      a ela jornada, serviço e uma folga, e vê-la ganhar coluna na visão
 *      "Profissionais" da Agenda.
 *   2. Marcar escolhendo o CLIENTE, ver QUEM ATENDE em cada horário, e abrir o
 *      compromisso pelo card: o clique que era mudo agora abre o detalhe, com o
 *      selo de origem, o cliente e quem atende. O mesmo detalhe abre pelo link
 *      `?agendamento=` — que é a porta da Central.
 *   3. A CENTRAL leva ao agendamento: o aviso com `ref_kind=calendar_appointment`
 *      vira link, e o link abre o detalhe certo.
 *
 * Sem `APP_URL`: as navegações são relativas e o `baseURL` do
 * `playwright.config.ts` resolve — ver o cabeçalho de
 * `agenda-remarcar-e-cancelar.spec.ts` para o custo de inventar porta.
 *
 * Medidas por FERRAMENTA (`getBoundingClientRect`), nunca a olho: o detalhe é
 * um Sheet ancorado à direita, e o defeito que esta base já pagou com Sheets é
 * o conteúdo transbordar em silêncio pela borda.
 */
const RAIZ = path.resolve(__dirname, "../..");

interface Creds {
  org_id: string;
  password: string;
  users: Record<string, { email: string; id?: string } | undefined>;
  agenda?: {
    tipo_id: string;
    tipo_nome: string;
    contato_id: string;
    contato_nome: string;
    profissional_id?: string;
    profissional_nome?: string;
  };
}

function lerCreds(): Creds {
  const p = path.join(RAIZ, ".e2e-creds.json");
  if (!fs.existsSync(p)) throw new Error("`.e2e-creds.json` ausente — rode `scripts/seed-e2e-credentials.ts`");
  let c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  // `profissional_id` é o campo que a 0245 acrescentou ao bloco: um bloco antigo
  // (de um run anterior a ela, no mesmo banco) não o tem, e o seed é idempotente.
  if (!c.agenda?.profissional_id) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-agenda.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  }
  if (!c.agenda?.profissional_id) throw new Error("seed-e2e-agenda não gravou `agenda.profissional_id`");
  return c;
}

async function entrar(page: Page, creds: Creds): Promise<void> {
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
}

/** A caixa do elemento cabe na janela — medido, não olhado. */
async function cabeNaJanela(page: Page, testid: string): Promise<void> {
  const medida = await page.getByTestId(testid).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { esquerda: r.left, direita: r.right, largura: window.innerWidth };
  });
  expect(medida.esquerda, `${testid} começa fora da tela`).toBeGreaterThanOrEqual(0);
  expect(medida.direita, `${testid} transborda a janela pela direita`).toBeLessThanOrEqual(medida.largura + 0.5);
}

test.describe.configure({ timeout: 120_000 });

test("profissional SEM LOGIN nasce pela tela, com jornada, serviço e folga — e ganha coluna na agenda", async ({ page }) => {
  const creds = lerCreds();
  await entrar(page, creds);

  await page.goto("/app/settings/tenant/agenda/profissionais");
  await expect(page.getByTestId("profissionais-da-agenda")).toBeVisible({ timeout: 20_000 });

  // A profissional do atendente (backfill/seed) já está na lista: a tela não
  // nasce vazia numa instalação que atendia antes da 0245.
  await expect(page.getByTestId(`profissional-${creds.agenda!.profissional_id}`)).toBeVisible({ timeout: 15_000 });

  const nome = `Bia E2E ${Date.now().toString(36)}`;
  await page.getByTestId("nova-profissional").click();
  await page.getByTestId("nova-profissional-nome").fill(nome);
  await page.getByTestId("salvar-nova-profissional").click();

  const linha = page.locator('[data-testid^="profissional-"]', { hasText: nome });
  await expect(linha, "a profissional cadastrada não apareceu na lista").toBeVisible({ timeout: 15_000 });
  await expect(linha).toContainText(/sem login/i);
  const id = (await linha.getAttribute("data-testid"))!.replace("profissional-", "");

  // ── Jornada: uma janela, salva, e o resumo da lista a reflete ─────────
  await page.getByTestId(`abrir-profissional-${id}`).click();
  await expect(page.getByTestId("editor-da-profissional")).toBeVisible();
  await page.getByTestId("adicionar-janela").click();
  await expect(page.getByTestId("janela-0")).toBeVisible();
  await page.getByTestId("salvar-jornada").click();
  await expect(linha, "o resumo da jornada não refletiu o que foi salvo").toContainText("08:00–18:00", {
    timeout: 15_000,
  });

  // ── Serviço: habilitada no tipo do seed ───────────────────────────────
  await page.getByTestId("aba-servicos").click();
  await page.getByTestId(`servico-${creds.agenda!.tipo_id}`).check();
  await page.getByTestId("salvar-servicos").click();
  await expect(linha).toContainText(creds.agenda!.tipo_nome, { timeout: 15_000 });

  // ── Folga: lançada e listada ──────────────────────────────────────────
  await page.getByTestId("aba-folgas").click();
  const daqui30 = await page.evaluate(() => {
    const d = new Date(Date.now() + 30 * 86_400_000);
    const dd = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
  });
  await page.getByTestId("folga-data").fill(daqui30);
  await page.getByTestId("lancar-folga").click();
  await expect(
    // `li`, e não qualquer `folga-*`: o formulário logo abaixo também tem
    // `folga-data`, `folga-sentido` e `folga-dia-todo`, e contaria como item.
    page.getByTestId("folgas-da-profissional").locator('li[data-testid^="folga-"]'),
    "a folga lançada não apareceu na lista",
  ).not.toHaveCount(0, { timeout: 15_000 });
  await cabeNaJanela(page, "editor-da-profissional");
  await page.keyboard.press("Escape");

  // ── E na Agenda, a visão por profissional tem a coluna dela ───────────
  await page.goto("/app/agenda");
  await expect(page.getByTestId("tela-agenda")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("visao-profissionais").click();
  await expect(page.getByTestId("grade-por-profissional")).toBeVisible();
  await expect(
    page.getByTestId(`coluna-profissional-${id}`),
    "a profissional sem login não ganhou coluna — é exatamente quem a feature existe para pôr na tela",
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`coluna-profissional-${creds.agenda!.profissional_id}`)).toBeVisible();
});

test("marcar com cliente: o horário diz quem atende, e o card abre o detalhe (também por ?agendamento=)", async ({
  page,
}) => {
  const creds = lerCreds();
  await entrar(page, creds);
  await page.goto("/app/agenda");
  await expect(page.getByTestId("tela-agenda")).toBeVisible({ timeout: 20_000 });
  const dias = await irParaASemanaSeguinte(page);

  await page.getByTestId("novo-agendamento").click();
  await expect(page.getByTestId("painel-de-marcacao")).toBeVisible({ timeout: 10_000 });
  const chipDoTipo = page.getByTestId(`tipo-${creds.agenda!.tipo_id}`);
  if (await chipDoTipo.count()) await chipDoTipo.click();

  // ── O CLIENTE, escolhido na base ──────────────────────────────────────
  await page.getByTestId("busca-de-cliente").fill(creds.agenda!.contato_nome);
  await page.getByTestId(`cliente-${creds.agenda!.contato_id}`).click();
  await expect(page.getByTestId("cliente-escolhido")).toContainText(creds.agenda!.contato_nome);

  // ── QUEM ATENDE, em cada horário ──────────────────────────────────────
  await escolherDiaDesenhado(page, dias);
  const horario = page.locator('[data-testid^="horario-"]').first();
  await expect(horario).toBeVisible({ timeout: 15_000 });
  await expect(
    horario,
    "o horário não diz quem atende — a rota não mandou `opcoes`, ou a tela as descartou",
  ).toHaveAttribute("data-quem", /\S/);
  await horario.click();
  await expect(page.getByTestId("confirmacao-quem")).toBeVisible();

  const criado = page.waitForResponse(
    (r) => r.url().includes("/api/v1/agenda/agendamentos") && r.request().method() === "POST",
  );
  await page.getByTestId("confirmar-marcacao").click();
  const resposta = await criado;
  expect(resposta.status(), "o POST de marcar não criou").toBe(201);
  const corpo = (await resposta.json()) as { data: { id: string; professional_ids?: string[] } };
  const id = corpo.data.id;
  expect(corpo.data.professional_ids?.length ?? 0, "marcou sem profissional").toBeGreaterThan(0);

  await page.getByTestId("ver-na-agenda").click();

  // ── O CLIQUE NO CARD, que era mudo ────────────────────────────────────
  const card = page.getByTestId(`agendamento-${id}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  const detalhe = page.getByTestId("detalhe-do-agendamento");
  await expect(detalhe, "clicar no card não abriu nada — o controle decorativo voltou").toBeVisible({
    timeout: 15_000,
  });
  await expect(detalhe).toHaveAttribute("data-id", id);
  await expect(page.getByTestId("selo-origem")).toHaveAttribute("data-origem", "ui");
  await expect(page.getByTestId("selo-situacao")).toBeVisible();
  await expect(page.getByTestId("detalhe-cliente")).toContainText(creds.agenda!.contato_nome);
  await expect(page.getByTestId("detalhe-profissionais").locator('[data-papel="principal"]')).toHaveCount(1);
  await expect(page.getByTestId("acoes-do-agendamento").getByTestId("acao-cancelar")).toBeEnabled();
  await cabeNaJanela(page, "detalhe-do-agendamento");
  expect(new URL(page.url()).searchParams.get("agendamento"), "o detalhe aberto não foi para a URL").toBe(id);

  // ── O MESMO detalhe pelo link — a porta que a Central usa ─────────────
  await page.goto(`/app/agenda?agendamento=${id}`);
  await expect(page.getByTestId("detalhe-do-agendamento")).toHaveAttribute("data-id", id, { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detalhe-do-agendamento")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("agendamento"), "fechar não limpou a URL").toBeNull();
});

test("a Central leva ao agendamento: aviso com ref_kind de agendamento vira link", async ({ page }) => {
  const creds = lerCreds();
  const env = carregarEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Um agendamento qualquer desta organização — o aviso só precisa apontar para
  // um que exista. Sem nenhum, a spec anterior não marcou: falha alto.
  const { data: alvo } = await admin
    .from("calendar_appointments")
    .select("id")
    .eq("organization_id", creds.org_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!alvo) throw new Error("nenhum agendamento na organização do e2e para o aviso apontar");
  const id = (alvo as { id: string }).id;

  // O aviso como `lib/agenda/aviso-da-marcacao.ts` o emite (kind `other`,
  // `ref_kind` = REF_KIND_DO_AGENDAMENTO). Inserido aqui porque o caminho real
  // passa por um turno de IA, que este job não sobe.
  const titulo = `E2E: a IA marcou ${Date.now().toString(36)}`;
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: creds.org_id,
    kind: "other",
    severity: "info",
    title: titulo,
    ref_kind: "calendar_appointment",
    ref_id: id,
  } as never);
  if (error) throw new Error(`agent_inbox_items: ${error.message}`);

  await entrar(page, creds);
  await page.goto("/app/ai/inbox");
  const aviso = page.getByTestId("inbox-item").filter({ hasText: titulo });
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  await aviso.getByTestId("inbox-item-destino").click();
  await page.waitForURL(/\/app\/agenda\?agendamento=/, { timeout: 20_000 });
  await expect(page.getByTestId("detalhe-do-agendamento")).toHaveAttribute("data-id", id, { timeout: 20_000 });
});
