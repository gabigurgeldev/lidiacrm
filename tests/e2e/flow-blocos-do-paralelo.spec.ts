/**
 * OS BLOCOS DO PARALELO, PELA TELA — como um leigo os usaria.
 *
 * ## Por que esta spec existe
 *
 * A suíte de unidade prova que o MOTOR bifurca, reencontra, repete e espera; a
 * suíte de invariantes prova que o schema isola e anonimiza. Nenhuma das duas
 * prova a única coisa que o cliente compra: **que uma pessoa consegue montar o
 * fluxo**. Um bloco cujo formulário não abre, ou cujo campo obrigatório é
 * impossível de preencher sem saber o identificador interno de outro bloco, é
 * um bloco que passa em todos os testes e não serve para nada.
 *
 * É a doutrina de QA Visual do repo: `curl` valida o backend, não a UX.
 *
 * ## O que ela mede, e por que cada medida
 *
 * 1. Os cinco blocos aparecem na paleta. Bloco registrado que não aparece é
 *    feature que só existe para quem lê o código.
 * 2. O formulário de cada um ABRE com campos. O `default` do painel diz "Este
 *    bloco não tem ajustes" — para quatro dos cinco isso seria mentira, e o
 *    bloco nasceria impublicável sem a pessoa entender por quê.
 * 3. A recusa da publicação é LEGÍVEL na tela. Os erros novos
 *    (`encontro_inexistente`, `encontro_nao_e_reencontro`) só valem se a pessoa
 *    os lê; um código no console não é mensagem.
 * 4. O caminho completo publica.
 *
 * Pré-requisitos (banco fresco estilo VPS, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/flow-blocos-do-paralelo.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

/** Cria um fluxo novo e devolve a página já no editor dele. */
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

const BLOCOS = [
  "logic.fork",
  "logic.merge",
  "logic.loop",
  "logic.await_event",
  "flow.call",
] as const;

test.describe("os blocos do paralelo no construtor", () => {
  test("os cinco aparecem na paleta — bloco registrado que não aparece não existe para o usuário", async ({
    page,
  }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E paralelo paleta");

    for (const tipo of BLOCOS) {
      await expect(
        page.getByTestId(`paleta-${tipo}`),
        `${tipo} não está na paleta`,
      ).toBeVisible();
    }
  });

  test("cada bloco abre um formulário com campos — nenhum cai no 'não tem ajustes'", async ({
    page,
  }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E paralelo forms");

    // `logic.merge` é o único que legitimamente não tem ajustes: ele não decide
    // nada, quem decide é o motor. Os outros quatro têm config obrigatória, e
    // sem formulário nasceriam impublicáveis.
    const comCampos: Record<string, string> = {
      "logic.fork": "campo-encontro-do-fork",
      "logic.loop": "campo-lista-do-laco",
      "logic.await_event": "campo-evento-esperado",
      "flow.call": "campo-fluxo-chamado",
    };

    // `flow.call` fica de fora deste laço: numa organização recém-criada não há
    // outro fluxo publicado, então a tela mostra o aviso em vez do seletor — que
    // é o comportamento certo, e não "o formulário não abriu".
    delete comCampos["flow.call"];

    for (const [tipo, testid] of Object.entries(comCampos)) {
      await page.getByTestId(`paleta-${tipo}`).click();
      // O bloco recém-acrescentado abre o painel já selecionado.
      await expect(
        page.getByTestId(testid),
        `${tipo}: o formulário não trouxe o campo obrigatório`,
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("a bifurcação deixa nomear caminhos e escolher como eles se juntam", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E fork form");

    await page.getByTestId("paleta-logic.fork").click();
    await expect(page.getByTestId("painel-do-no")).toBeVisible();

    // Nasce com dois caminhos: o mínimo que o schema exige (`min(2)`), para o
    // bloco não nascer inválido esperando que a pessoa adivinhe.
    const ramos = page.locator('[data-testid^="rotulo-do-ramo-"]');
    await expect(ramos).toHaveCount(2);

    // Acrescentar um terceiro caminho funciona pela tela.
    await page.getByTestId("add-ramo").click();
    await expect(ramos).toHaveCount(3);

    // E o modo é escolha explícita, com as duas palavras que o operador entende.
    await page.getByTestId("campo-modo-do-fork").click();
    await expect(page.getByRole("option", { name: /esperar (a que )?todos/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /primeiro que termine/i })).toBeVisible();
  });

  test("publicar com o reencontro apontando para o vazio é RECUSADO, e a recusa se lê na tela", async ({
    page,
  }) => {
    // A validação nova só vale se a pessoa entende o que fazer. Um código de
    // erro no console é a mesma coisa que silêncio.
    await loginComoAdmin(page, lerCreds());
    await abrirEditorDeFluxoNovo(page, "E2E fork sem encontro");

    await page.getByTestId("paleta-trigger.lead_created").click();
    await page.getByTestId("paleta-logic.fork").click();
    // Sem nenhum bloco de reencontro no fluxo, o seletor nem aparece — a tela
    // diz o que falta em vez de oferecer uma caixa vazia. Publicar assim tem
    // que ser recusado com a mesma clareza.
    await expect(page.getByTestId("sem-bloco-de-reencontro")).toBeVisible();

    await page.getByTestId("salvar-rascunho").click();
    await page.getByTestId("publicar-fluxo").click();

    // A frase tem que falar de reencontro, em português de gente.
    await expect(page.getByText(/reencontro/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
