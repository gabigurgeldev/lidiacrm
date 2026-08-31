/**
 * "CRIAR COM IA" NO EDITOR DE FLUXO, PELA TELA.
 *
 * ## O que esta spec prova, e o que ela NÃO prova
 *
 * Prova a jornada até o ponto que o ambiente de CI consegue sustentar: a porta
 * existe DENTRO do editor de fluxo (não é tela separada), o botão abre o
 * painel sem sair de `/app/flows/[id]`, o campo de pedido funciona, e — o
 * caminho determinístico em CI — sem provedor de IA configurado, a pessoa
 * recebe a frase amigável em vez de tela em branco ou erro cru.
 *
 * NÃO prova a geração de verdade (streaming preenchendo o canvas, perguntas
 * de múltipla escolha, nós aparecendo ao vivo): isso exige uma credencial de
 * IA de verdade (Anthropic/OpenRouter), que o workflow de e2e não injeta —
 * confirmado em `.github/workflows/e2e.yml`, nenhuma chave de provedor de IA
 * aparece no `env:` do job. Sem chave, `resolverModeloDoPonto` devolve `null`
 * e a rota recusa ANTES de streamar — é exatamente esse recuo que a spec
 * exercita e prova.
 *
 * ## Por que o caminho "sem provedor" é o certo para provar em CI
 *
 * Não é o caminho feliz da feature, mas é o caminho GARANTIDO: qualquer
 * instalação recém-criada (inclusive uma VPS fresca que ainda não configurou
 * IA) passa por ele. Provar que a mensagem de erro é legível e não deixa a
 * tela travada é, para uma instalação nova, tão importante quanto provar o
 * caminho feliz — é a PRIMEIRA IMPRESSÃO de quem clica no botão sem ter
 * configurado nada ainda.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/flow-builder-ia.spec.ts
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

test.describe("criar fluxo com IA", () => {
  test("o botão vive DENTRO do editor, e sem provedor configurado a recusa é legível", async ({
    page,
  }) => {
    await loginComoAdmin(page, lerCreds());

    // ─── Chega-se pelo editor de um fluxo, nunca por rota própria ──────────
    await page.goto("/app/flows");
    const nome = `E2E IA ${Date.now()}`;
    await page.getByTestId("campo-nome-do-fluxo").fill(nome);
    await page.getByTestId("form-novo-fluxo").getByRole("button", { name: /criar fluxo/i }).click();

    await page.getByRole("link", { name: nome }).click();
    await page.waitForURL(/\/app\/flows\/[0-9a-f-]{36}/);

    // O botão está no MESMO header do "Salvar rascunho"/"Publicar" — é a prova
    // de que não existe uma segunda tela para a feature.
    const botaoIa = page.getByTestId("abrir-construtor-ia");
    await expect(botaoIa).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("salvar-rascunho")).toBeVisible();
    await botaoIa.click();

    // ─── O painel abre SOBRE o canvas, sem navegar para lugar nenhum ───────
    await expect(page.getByTestId("construtor-com-ia")).toBeVisible();
    expect(page.url()).toContain("/app/flows/");

    await page.getByTestId("ia-pedido").fill(
      "quando um lead novo entrar, espera 10 minutos e avisa o vendedor no WhatsApp",
    );
    await page.getByTestId("ia-continuar").click();

    // ─── O caminho garantido em CI: sem chave, a recusa é legível ──────────
    const erro = page.getByTestId("ia-erro");
    await expect(erro).toBeVisible({ timeout: 20_000 });
    await expect(erro).not.toHaveText(/undefined|null|\[object|Error:/i);

    // A tela não travou: o erro não bloqueia o painel, e fechar volta ao
    // editor normal — canvas destravado, paleta clicável de novo.
    await page.getByTestId("ia-fechar").click();
    await expect(page.getByTestId("construtor-com-ia")).toBeHidden();
    await expect(page.getByTestId("paleta")).toBeVisible();
  });
});
