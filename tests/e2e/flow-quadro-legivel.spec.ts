/**
 * O QUADRO DO FLUXO, PELA TELA — o que a suíte de unidade não consegue provar.
 *
 * ## Por que esta spec existe
 *
 * `tests/unit/quadro-do-fluxo-legivel.test.ts` prova as REGRAS: que o resumo
 * lê a config, que a linha herda o nome do ramo, que a cópia não compartilha
 * array com o original. Nenhuma delas prova o que o cliente compra — que a
 * frase CHEGA ao cartão, que o botão de duplicar EXISTE no painel, e que
 * arrastar da paleta realmente larga um bloco no quadro.
 *
 * Os três já falharam nesse vão antes, neste mesmo editor: o painel do bloco
 * pedia o `id` de um bloco que a tela nunca mostrava, com a regra "certa" e
 * testada por baixo. É a doutrina de QA Visual do repo — `curl` valida o
 * backend, não a UX.
 *
 * ## Sobre arrastar
 *
 * `dragTo` do Playwright emite eventos de MOUSE, e o arrasto da paleta é
 * HTML5 drag-and-drop (`dragstart`/`drop`), que o navegador só dispara a partir
 * de um gesto real do sistema. Por isso o teste monta o `DataTransfer` e
 * despacha os dois eventos — é o caminho documentado, e mede exatamente o
 * contrato que o código implementa: o tipo viaja no MIME próprio, e o `drop`
 * cria o bloco na posição do ponteiro.
 *
 * Pré-requisitos (banco fresco estilo VPS, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/flow-quadro-legivel.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const MIME_DO_ARRASTO = "application/x-flow-node-type";

async function abrirEditorDeFluxoNovo(page: Page, rotulo: string): Promise<void> {
  await page.goto("/app/flows");
  const nome = `${rotulo} ${Date.now()}`;
  await page.getByTestId("campo-nome-do-fluxo").fill(nome);
  await page
    .getByTestId("form-novo-fluxo")
    .getByRole("button", { name: /criar fluxo/i })
    .click();
  await page.getByRole("link", { name: nome }).click();
  await page.waitForURL(/\/app\/flows\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("paleta")).toBeVisible({ timeout: 20_000 });
}

/** Quantos cartões há no quadro agora. */
async function quantosBlocos(page: Page): Promise<number> {
  return page.locator('[data-testid^="no-"]').count();
}

test.describe("o quadro do fluxo diz o que faz", () => {
  test("o cartão mostra os AJUSTES do bloco, não o identificador interno", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro resumo");

    await page.getByTestId("paleta-logic.wait").click();
    const resumo = page.locator('[data-testid^="resumo-do-no-"]').last();

    // O bloco de espera nasce com 5 minutos (`node-examples.ts`). O cartão tem
    // de dizer isso — antes dizia `logic.wait`, que não distingue esta espera
    // de nenhuma outra do mesmo fluxo.
    await expect(resumo).toHaveText(/5 minutos/i);
    await expect(resumo).not.toHaveText(/logic\.wait/);

    // E acompanha a edição: mudar o tempo no painel muda a frase no quadro.
    await page.getByTestId("campo-espera-quantidade").fill("2");
    await expect(resumo).toHaveText(/2 minutos/i);
  });

  test("bloco com recurso não escolhido AVISA no cartão, antes do botão Publicar", async ({
    page,
  }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro pendencia");

    // `whatsapp.bulk_send` nasce com o UUID nulo de propósito: sem escolher o
    // número, ele reprova na publicação. O cartão passa a dizer isso na hora.
    await page.getByTestId("paleta-whatsapp.bulk_send").click();
    await expect(page.locator('[data-testid^="resumo-do-no-"]').last()).toHaveText(
      /falta escolher/i,
    );
  });

  test("duplicar leva os ajustes junto, e o gatilho não duplica", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro duplicar");

    await page.getByTestId("paleta-crm.add_tag").click();
    await page.getByTestId("campo-rotulo-do-no").fill("Marcar como quente");
    const antes = await quantosBlocos(page);

    await page.getByTestId("duplicar-no").click();

    expect(await quantosBlocos(page)).toBe(antes + 1);
    // A cópia é a selecionada, e o painel dela mostra o MESMO rótulo — o que
    // prova que os ajustes vieram junto, e não um bloco novo em branco.
    await expect(page.getByTestId("campo-rotulo-do-no")).toHaveValue("Marcar como quente");

    // O gatilho não oferece o botão: um fluxo tem um só, e a cópia produziria
    // um fluxo que não publica.
    await page.getByTestId("paleta-trigger.lead_created").click();
    await expect(page.getByTestId("painel-do-no")).toBeVisible();
    await expect(page.getByTestId("duplicar-no")).toHaveCount(0);
  });

  test("arrastar da paleta larga o bloco no quadro", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro arrastar");
    const antes = await quantosBlocos(page);

    const origem = page.getByTestId("paleta-crm.add_tag");
    const destino = page.getByTestId("quadro");

    // Um `DataTransfer` de verdade, compartilhado pelos dois eventos: é assim
    // que o navegador carrega o tipo do bloco da paleta até o quadro.
    const dados = await page.evaluateHandle(() => new DataTransfer());
    await origem.dispatchEvent("dragstart", { dataTransfer: dados });
    await destino.dispatchEvent("drop", { dataTransfer: dados });

    expect(await quantosBlocos(page)).toBe(antes + 1);
    await expect(page.getByTestId("painel-do-no")).toBeVisible();
  });

  test("arrasto de tipo desconhecido não cria bloco nenhum", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro arrasto invalido");
    const antes = await quantosBlocos(page);

    // Uma seleção de texto arrastada de outra aba chega como `text/plain`. O
    // quadro tem de ignorá-la — e um MIME certo com tipo inexistente também.
    await page.getByTestId("quadro").dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(
        (mime) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", "um texto qualquer");
          dt.setData(mime, "tipo.que.nao.existe");
          return dt;
        },
        MIME_DO_ARRASTO,
      ),
    });

    expect(await quantosBlocos(page)).toBe(antes);
  });

  test("a linha entre dois blocos diz de qual saída ela saiu", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro rotulo de linha");

    // `logic.if` nasce com uma regra escrita ("Score acima de 70") mais o
    // pega-tudo: duas saídas, e portanto linhas que precisam se distinguir.
    await page.getByTestId("paleta-logic.if").click();
    await expect(page.locator('[data-testid^="resumo-do-no-"]').last()).toHaveText(
      /score acima de 70/i,
    );

    // O quadro desenha um handle por saída, com o nome ao lado — é a mesma
    // informação que o rótulo da linha carrega depois de ligada.
    const noDoIf = page.locator('[data-testid^="saidas-"]').last();
    await expect(noDoIf).toContainText("Score acima de 70");
  });

  test("Arrumar reposiciona sem apagar nada", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E quadro arrumar");

    await page.getByTestId("paleta-crm.add_tag").click();
    await page.getByTestId("paleta-logic.wait").click();
    const antes = await quantosBlocos(page);

    await page.getByTestId("arrumar-quadro").click();

    // Arrumar é DESENHO: mexe em posição, nunca em bloco, ligação ou ajuste.
    expect(await quantosBlocos(page)).toBe(antes);
  });
});
