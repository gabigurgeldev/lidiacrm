/**
 * UMA FOTO NO ACERVO, PELA TELA — a metade "Conhecimento" da jornada J38.
 *
 * O agente pode ENVIAR ao cliente uma foto do acervo, e ele a acha pela
 * DESCRIÇÃO (o modelo não vê a imagem ao procurar). Então o que esta spec prova
 * é o que a pessoa precisa conseguir fazer sozinha para que o envio funcione:
 *
 *  1. **Escolher "Foto" muda o formulário**: aparece o campo de imagem e a
 *     descrição obrigatória — e a prévia da foto escolhida, antes de subir.
 *  2. **A foto entra no acervo**: o cartão mostra a miniatura CARREGADA (não um
 *     quadro vazio — `naturalWidth > 0` prova que o 302 da rota levou a uma URL
 *     assinada que o Storage serviu) e a descrição que foi escrita.
 *  3. **A descrição se corrige no cartão**: é a única coisa que torna a foto
 *     alcançável, e errá-la não pode exigir apagar e subir de novo.
 *
 * ═══ O que esta spec NÃO prova ═══
 *
 * Que o agente ENVIA a foto (J38.6/J38.7): isso exige chave de modelo e número
 * pareado, que o CI não tem. Nem que a foto vira trecho buscável: sem chave de
 * embedding o material fica "Esperando a chave", e esta spec não depende dela —
 * de propósito, para não ser PULADA no CI como 4 dos 6 casos de
 * `acervo-de-conhecimento.spec.ts`.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";

const NOME_FOTO = `E2E Foto ${Date.now()}`;
const DESCRICAO = "Jumbo cor 1B, 400 g, pacote. Temos também nas cores 27, 30 e 613.";
const DESCRICAO_NOVA = "Jumbo cor 1B, 400 g, pacote. Agora também na cor 4.";

/**
 * Um PNG de verdade, montado em memória: 1×1 pixel. A rota confere a
 * ASSINATURA dos bytes contra o formato declarado, então um buffer qualquer com
 * `image/png` seria recusado — e a recusa se leria como defeito da tela.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let creds: CredsE2E = lerCreds();

// Uma sessão para a jornada inteira, como em `acervo-de-conhecimento.spec.ts`:
// o login é limitado por IP, e um login por caso estoura o teto no CI.
let contexto: BrowserContext;
let page: Page;

test.describe("acervo: foto que o agente pode enviar", () => {
  // SERIAL: o cartão que o caso 2 confere é o que o caso 3 edita. Teto real:
  // primeira renderização em `next start` + upload ao Storage local.
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    contexto = await browser.newContext();
    page = await contexto.newPage();
    creds = (await loginComoAdmin(page, creds)) as CredsE2E;
  });

  test.afterAll(async () => {
    await contexto?.close();
  });

  test("escolher Foto pede a imagem e a descrição, e mostra a prévia antes de subir", async () => {
    await page.goto("/app/ai/knowledge/sources");
    await page.getByTestId("acervo-adicionar").click();
    await page.getByTestId("material-tipo-imagem").click();

    // O campo de texto colado some: foto não é "cole o conteúdo".
    await expect(page.getByTestId("material-conteudo")).toHaveCount(0);
    await expect(page.getByTestId("material-descricao")).toBeVisible();

    const campo = page.getByTestId("material-foto");
    await expect(campo).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await campo.setInputFiles({ name: "jumbo-1b.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByTestId("material-foto-previa")).toBeVisible();
  });

  test("a foto entra no acervo com a miniatura carregada e a descrição no cartão", async () => {
    // Continua no diálogo aberto pelo caso anterior, com a foto já escolhida.
    await page.getByTestId("material-nome").fill(NOME_FOTO);
    await page.getByTestId("material-descricao").fill(DESCRICAO);
    await page.getByTestId("material-criar").click();

    const cartao = page
      .locator('[data-testid^="material-"]')
      .filter({ hasText: NOME_FOTO })
      .first();
    await expect(cartao).toBeVisible({ timeout: 20_000 });

    await expect(cartao.locator('[data-testid^="material-descricao-"]')).toHaveText(DESCRICAO);

    // VISÍVEL não basta: um <img> quebrado também ocupa o quadro. A prova é o
    // navegador ter decodificado a imagem que o 302 entregou.
    const miniatura = cartao.locator('[data-testid^="material-miniatura-"]');
    await expect(miniatura).toHaveAttribute("alt", NOME_FOTO);
    await expect
      .poll(() => miniatura.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
        message: "a miniatura não carregou — a rota GET …/imagem não levou a uma foto servida",
      })
      .toBeGreaterThan(0);
  });

  test("a descrição se corrige no próprio cartão", async () => {
    const cartao = page
      .locator('[data-testid^="material-"]')
      .filter({ hasText: NOME_FOTO })
      .first();

    await cartao.locator('[data-testid^="material-editar-descricao-"]').click();
    const campo = page.getByTestId("foto-descricao-editar");
    // Abre com o texto ATUAL: salvar um campo vazio apagaria o que torna a foto alcançável.
    await expect(campo).toHaveValue(DESCRICAO);
    await campo.fill(DESCRICAO_NOVA);
    await page.getByTestId("foto-descricao-salvar").click();

    await expect(cartao.locator('[data-testid^="material-descricao-"]')).toHaveText(
      DESCRICAO_NOVA,
      { timeout: 20_000 },
    );
  });
});
