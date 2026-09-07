/**
 * APAGAR BLOCO, RENOMEAR FLUXO, EXCLUIR FLUXO — PELA TELA.
 *
 * ## Os defeitos que esta spec pina
 *
 * 1. **"Não consigo apagar o bloco de início."** O botão "Remover este bloco"
 *    era removido do DOM quando o bloco era o gatilho, sem tooltip e sem uma
 *    linha dizendo por quê.
 * 2. **"Não consigo apagar alguns blocos."** Era LAYOUT: o botão tinha
 *    `mt-auto` DENTRO do `<aside>` que rola, então em bloco de formulário longo
 *    (o aviso no WhatsApp, com textarea de 6 linhas) ele descia com o conteúdo e
 *    ficava abaixo da dobra. Ninguém rola um painel que parece terminado.
 * 3. **Tecla `Delete` inerte.** O `<ReactFlow>` não passava `deleteKeyCode`, e o
 *    default do @xyflow é só `Backspace`.
 * 4. **Não dá para excluir nem renomear um fluxo.** A rota existia desde o
 *    primeiro dia e a lista não tinha porta nenhuma para ela.
 *
 * ## O caso 1 é medido por FERRAMENTA, não a olho
 *
 * `boundingBox()` do botão contra o do painel. Um teste que só chamasse
 * `.click()` passaria com o botão fora da tela — o Playwright rola até o
 * elemento antes de clicar, que é exatamente o que a pessoa não faz.
 *
 * ## O que NÃO é provado aqui
 *
 * O 409 de execução viva na exclusão. Semear `flow_executions` em `waiting`
 * (com versão publicada e ponteiro coerente) não cabe na receita do job de e2e;
 * a recusa está coberta pelo invariante de banco e pelo teste da rota. Aqui ela
 * está declarada como NÃO MEDIDA.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/fluxo-apaga-renomeia-exclui.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

/**
 * Um grafo com ids ESTÁVEIS.
 *
 * Bloco acrescentado pela paleta recebe id derivado do relógio
 * (`n<timestamp36>`), que nenhum seletor consegue prever. Semear o rascunho pela
 * API dá `no-t1`, `no-w1` e `no-av1` — e o palco continua sendo o mesmo canvas
 * real que a pessoa usa.
 *
 * `av1` é `whatsapp.notify_user` de propósito: é o tipo de formulário mais longo
 * do painel, o que empurrava o botão para baixo da dobra.
 */
const GRAFO = {
  nodes: [
    {
      id: "t1",
      type: "trigger.lead_created",
      label: "Lead novo",
      position: { x: 80, y: 80 },
      config: {},
    },
    {
      id: "w1",
      type: "logic.wait",
      label: "Espera 10 minutos",
      position: { x: 340, y: 80 },
      config: { duracao_ms: 600000 },
    },
    {
      id: "av1",
      type: "whatsapp.notify_user",
      label: "Avisar o vendedor",
      position: { x: 600, y: 80 },
      config: {
        destinatario: { tipo: "dono_do_lead" },
        mensagem: "Novo lead: {{lead.title}}",
      },
    },
  ],
  edges: [
    { id: "e1", source: "t1", target: "w1", branch_id: "else" },
    { id: "e2", source: "w1", target: "av1", branch_id: "else" },
  ],
};

async function criarFluxo(page: Page, nome: string): Promise<string> {
  const criado = await page.request.post("/api/v1/flows", { data: { name: nome } });
  expect(criado.ok(), `criar fluxo falhou: ${criado.status()}`).toBe(true);
  const { data } = (await criado.json()) as { data: { id: string } };
  return data.id;
}

/** Cria o fluxo, semeia o rascunho e abre o editor. */
async function abrirComGrafo(page: Page, nome: string): Promise<string> {
  const id = await criarFluxo(page, nome);
  const salvo = await page.request.patch(`/api/v1/flows/${id}`, { data: { draft_graph: GRAFO } });
  expect(salvo.ok(), `semear rascunho falhou: ${salvo.status()}`).toBe(true);
  await page.goto(`/app/flows/${id}`);
  await expect(page.getByTestId("no-t1")).toBeVisible({ timeout: 20_000 });
  return id;
}

test.describe("apagar bloco no editor", () => {
  test("o botão de remover fica DENTRO do painel mesmo no bloco de formulário longo", async ({
    page,
  }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirComGrafo(page, `E2E apagar ${Date.now()}`);

    await page.getByTestId("no-av1").click();
    const painel = page.getByTestId("painel-do-no");
    await expect(painel).toBeVisible();

    const botao = page.getByTestId("apagar-no");
    await expect(botao).toBeVisible();

    const caixaPainel = await painel.boundingBox();
    const caixaBotao = await botao.boundingBox();
    expect(caixaPainel).not.toBeNull();
    expect(caixaBotao).not.toBeNull();

    // A medida, e não a impressão: o rodapé é irmão da área que rola, então o
    // fim do botão cabe dentro do fim do painel sem ninguém rolar nada.
    expect(caixaBotao!.y + caixaBotao!.height).toBeLessThanOrEqual(
      caixaPainel!.y + caixaPainel!.height + 1,
    );
  });

  test("bloco comum sai pelo botão, com as ligações dele", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirComGrafo(page, `E2E apagar comum ${Date.now()}`);

    await page.getByTestId("no-w1").click();
    await page.getByTestId("apagar-no").click();

    // Sem confirmação: só o bloco de início a pede.
    await expect(page.getByTestId("no-w1")).toBeHidden();
    await expect(page.getByTestId("no-t1")).toBeVisible();
    await expect(page.getByTestId("no-av1")).toBeVisible();
    // A aresta que entrava e a que saía foram junto — nenhuma linha órfã.
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("bloco de início sai, mas só depois do aviso", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirComGrafo(page, `E2E apagar inicio ${Date.now()}`);

    await page.getByTestId("no-t1").click();
    await page.getByTestId("apagar-no").click();

    const aviso = page.getByTestId("confirmar-remover-inicio");
    await expect(aviso).toBeVisible();
    await page.getByTestId("cancelar-remocao").click();
    await expect(page.getByTestId("no-t1")).toBeVisible();

    await page.getByTestId("apagar-no").click();
    await expect(aviso).toBeVisible();
    await page.getByTestId("confirmar-remocao").click();
    await expect(page.getByTestId("no-t1")).toBeHidden();
  });

  test("a tecla Delete apaga no quadro, e não enquanto se digita", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirComGrafo(page, `E2E tecla ${Date.now()}`);

    // Digitando no painel, a tecla é do CAMPO — o bloco não pode sumir.
    await page.getByTestId("no-av1").click();
    const campo = page.getByTestId("campo-rotulo-do-no");
    await campo.click();
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("no-av1")).toBeVisible();

    // No quadro, a tecla apaga.
    await page.getByTestId("no-av1").click();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("no-av1")).toBeHidden();
  });

  test("quadro sem bloco nenhum avisa e não emite PATCH", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    const id = await abrirComGrafo(page, `E2E vazio ${Date.now()}`);

    let patches = 0;
    await page.route(`**/api/v1/flows/${id}`, (rota) => {
      if (rota.request().method() === "PATCH") patches += 1;
      return rota.continue();
    });

    for (const no of ["w1", "av1"]) {
      await page.getByTestId(`no-${no}`).click();
      await page.getByTestId("apagar-no").click();
    }
    await page.getByTestId("no-t1").click();
    await page.getByTestId("apagar-no").click();
    await page.getByTestId("confirmar-remocao").click();
    await expect(page.getByTestId("no-t1")).toBeHidden();

    await page.getByTestId("salvar-rascunho").click();
    await expect(page.getByText(/sem blocos/i)).toBeVisible();
    expect(patches).toBe(0);
  });

  test("publicar sem bloco de início continua sendo recusado, com o motivo", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirComGrafo(page, `E2E sem gatilho ${Date.now()}`);

    await page.getByTestId("no-t1").click();
    await page.getByTestId("apagar-no").click();
    await page.getByTestId("confirmar-remocao").click();
    await expect(page.getByTestId("no-t1")).toBeHidden();

    await page.getByTestId("publicar-fluxo").click();
    await expect(page.getByText(/bloco de início/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("renomear e excluir fluxo na lista", () => {
  test("renomeia, recusa nome repetido e exclui", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());

    const carimbo = Date.now();
    const ocupado = `E2E ocupado ${carimbo}`;
    const original = `E2E alvo ${carimbo}`;
    const novo = `E2E renomeado ${carimbo}`;

    await criarFluxo(page, ocupado);
    const alvo = await criarFluxo(page, original);

    await page.goto("/app/flows");
    await expect(page.getByTestId(`fluxo-${alvo}`)).toBeVisible({ timeout: 20_000 });

    // ─── renomear ────────────────────────────────────────────────────────────
    await page.getByTestId(`menu-do-fluxo-${alvo}`).click();
    await page.getByTestId(`renomear-fluxo-${alvo}`).click();
    const campo = page.getByTestId("campo-novo-nome-do-fluxo");
    await expect(campo).toHaveValue(original);
    await campo.fill(novo);
    await page.getByTestId("salvar-novo-nome").click();
    await expect(page.getByTestId(`fluxo-${alvo}`)).toContainText(novo);

    // O cabeçalho do editor lê a mesma chave de cache e troca junto.
    await page.goto(`/app/flows/${alvo}`);
    await expect(page.getByRole("heading", { name: novo })).toBeVisible({ timeout: 20_000 });
    await page.goto("/app/flows");

    // ─── nome repetido é recusado, e o diálogo NÃO fecha ─────────────────────
    await page.getByTestId(`menu-do-fluxo-${alvo}`).click();
    await page.getByTestId(`renomear-fluxo-${alvo}`).click();
    await page.getByTestId("campo-novo-nome-do-fluxo").fill(ocupado);
    await page.getByTestId("salvar-novo-nome").click();
    await expect(page.getByText(/já existe um fluxo com esse nome/i)).toBeVisible();
    await expect(page.getByTestId("dialogo-renomear-fluxo")).toBeVisible();
    await page.getByRole("button", { name: /^Cancelar$/ }).click();

    // ─── excluir ─────────────────────────────────────────────────────────────
    await page.getByTestId(`menu-do-fluxo-${alvo}`).click();
    await page.getByTestId(`excluir-fluxo-${alvo}`).click();
    await expect(page.getByTestId("confirmar-excluir-fluxo")).toBeVisible();
    await page.getByTestId("confirmar-exclusao-do-fluxo").click();
    await expect(page.getByTestId(`fluxo-${alvo}`)).toBeHidden();

    // Sumiu do servidor, não só da tela.
    await page.reload();
    await expect(page.getByTestId(`fluxo-${alvo}`)).toBeHidden({ timeout: 20_000 });
  });
});
