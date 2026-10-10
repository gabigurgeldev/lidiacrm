/**
 * O BOTÃO TESTAR DO AGENTE: O QUE ESTÁ NA TELA, PELO ATENDIMENTO DE VERDADE, E
 * NADA FICA.
 *
 * Como uma pessoa usaria: cria o agente, muda as instruções SEM salvar, abre a
 * aba Teste e escreve como se fosse o cliente. Três coisas precisam ser
 * verdade, e cada uma já foi mentira:
 *
 *  1. o teste usa o texto NÃO salvo — o painel antigo testava a última versão
 *     salva, e quem ajustava o prompt via o efeito do anterior;
 *  2. voltar para Configuração mantém a edição — trocar de aba desmontava o
 *     formulário e o que estava sem salvar sumia;
 *  3. o cliente do teste não existe no CRM depois — o ensaio roda o turno de
 *     produção numa transação desfeita (`lib/agent-engine/ensaio`); o painel
 *     antigo criava dado real.
 *
 * O desfecho do turno depende do modelo, e o CI não tem chave de IA: sem ela o
 * ensaio termina em "não conseguiu rodar", com o motivo. É um desfecho honesto
 * e basta para esta prova — o que se mede aqui é o caminho da tela ao motor e
 * de volta, não a qualidade da resposta. Com `E2E_ENSAIO_COM_IA=1` (chave
 * válida no ambiente) a spec exige uma resposta.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect } from "@playwright/test";

import { loginComoAdmin, lerCreds, type CredsE2E } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), ".superpowers", "evidence", "agente-testa-sem-salvar");

let creds: CredsE2E = lerCreds();

test.use({ locale: "pt-BR" });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  creds = await loginComoAdmin(page, creds);
});

test("testar usa o que está na tela, mantém a edição, e não deixa o cliente do teste no CRM", async ({
  page,
}) => {
  // ── Um agente novo, criado como uma pessoa faria ────────────────────────
  await page.goto("/app/ai/agents/new");
  await page.locator("#name").fill(`Teste sem salvar ${Date.now()}`);
  await page
    .locator("textarea")
    .first()
    .fill("Você atende uma pizzaria. Responda curto e com educação.");
  for (const id of ["model", "credential_id", "channel_session_id"]) {
    const gatilho = page.locator(`#${id}`);
    if ((await gatilho.count()) === 0) continue;
    await gatilho.click();
    await page.getByRole("option").first().click();
  }
  await page.getByRole("button", { name: /criar agent/i }).click();
  await page.waitForURL(/\/app\/ai\/agents\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // ── Muda as instruções e NÃO salva ───────────────────────────────────────
  const instrucoes = page.locator("textarea.font-mono").first();
  await instrucoes.waitFor({ state: "visible", timeout: 60_000 });
  const naoSalvo = `Você atende a pizzaria do Zé — texto não salvo ${Date.now()}.`;
  await instrucoes.fill(naoSalvo);

  // ── Testa ────────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: "Teste" }).click();
  await expect(page.getByTestId("ensaio-aviso")).toBeVisible();
  const nomeDoCliente = `Cliente E2E ${Date.now()}`;
  await page.getByText("Mais opções do teste").click();
  await page.locator("#ensaio-nome").fill(nomeDoCliente);
  await page.getByLabel("Mensagem do cliente").fill("Vocês entregam no centro?");

  const resposta = page.waitForResponse((r) => r.url().endsWith("/ensaio") && r.request().method() === "POST", {
    timeout: 150_000,
  });
  await page.getByTestId("ensaio-enviar").click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as { versao: { system_prompt: string } };

  // 1. O que foi testado é o que está na tela.
  expect(corpo.versao.system_prompt, "o teste mandou outra coisa que não o texto da tela").toBe(naoSalvo);

  // O turno rodou e voltou com relatório. 503 (motor sem banco) e 500 também
  // pintariam a tela de erro — e seriam lidos como "funcionou" se só a tela
  // fosse olhada.
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByTestId("ensaio-desfecho")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(EVIDENCIA, "01-resultado-do-teste.png"), fullPage: true });

  if (process.env.E2E_ENSAIO_COM_IA === "1") {
    await expect(page.getByTestId("ensaio-desfecho")).toHaveAttribute("data-desfecho", "respondeu");
    await expect(page.getByTestId("ensaio-bolha-agente").first()).toContainText("não enviada");
  }

  // 2. A edição continua lá.
  await page.getByRole("tab", { name: "Configuração" }).click();
  await expect(instrucoes).toHaveValue(naoSalvo);

  // 3. O cliente do teste não existe no CRM.
  const busca = await page.request.get(`/api/v1/contacts?search=${encodeURIComponent(nomeDoCliente)}`);
  expect(busca.ok()).toBe(true);
  const contatos = ((await busca.json()) as { data?: unknown[] }).data ?? [];
  expect(contatos, "o teste deixou o cliente sintético no CRM").toHaveLength(0);
});
