/**
 * "Corrigir com IA", pela tela, como um dono faria.
 *
 * Do editor do agente, o botão "Corrigir com IA" abre o assistente no modo
 * corrigir, já no agente certo. A pessoa relata o problema, vê as causas, vê a
 * correção antes × depois e salva. O que se prova:
 *
 *  - o botão do editor leva ao agente certo;
 *  - a correção vira RASCUNHO (nada é publicado), com o resumo do problema no
 *    histórico de versões — o laço de retorno visível.
 *
 * O MODELO é interceptado (`correcao/diagnosticar` e `correcao/propor`): o que
 * se testa é a tela e a escrita, não a criatividade da IA. A escrita
 * (`correcao/aplicar`) é REAL, contra o banco do teste.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts && pnpm exec tsx scripts/seed-e2e-followup-agent.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/agente-corrigido-por-ia.spec.ts
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const PROMPT = "Quem você é: a Bia, da Clínica Sorriso.\nNunca dê desconto.";
const PROMPT_CORRIGIDO = `${PROMPT} Se pedirem desconto, diga que o preço é fixo e ofereça parcelar em até 3x.`;
const PROBLEMA = "O agente está dando desconto sem autorização quando o cliente insiste.";

test.describe("corrigir agente com IA", () => {
  test("do editor ao rascunho corrigido, sem publicar nada", async ({ page }) => {
    const creds = await loginComoAdmin(page, lerCreds());
    const fixtures = (creds as unknown as { followup_agent_fixtures?: { credential_id: string; channel_session_id: string } })
      .followup_agent_fixtures;
    test.skip(!fixtures, "rode scripts/seed-e2e-followup-agent.ts (credencial de IA + número)");

    const marca = Date.now().toString(36);
    const cria = await page.request.post("/api/v1/ai/agents", {
      data: {
        name: `E2E Corrigir ${marca}`,
        version: {
          system_prompt: PROMPT,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          credential_id: fixtures!.credential_id,
          channel_session_id: fixtures!.channel_session_id,
        },
      },
    });
    expect(cria.status()).toBe(201);
    const criado = (await cria.json()) as { data: { agent: { id: string }; version: { id: string } } };
    const agentId = criado.data.agent.id;
    const versaoId = criado.data.version.id;

    await page.route(`**/api/v1/ai/agents/${agentId}/correcao/diagnosticar`, (route) =>
      route.fulfill({
        json: {
          data: {
            diagnostico: {
              resumo: "A regra do desconto não diz o que fazer quando o cliente insiste.",
              hipoteses: [{ causa: "Proibição sem alternativa", evidencia: "Nunca dê desconto.", onde: "prompt" }],
              perguntas: [],
            },
            base: { id: versaoId, version_number: 1, partiu_do_rascunho: true },
          },
        },
      }),
    );
    await page.route(`**/api/v1/ai/agents/${agentId}/correcao/propor`, (route) =>
      route.fulfill({
        json: {
          data: {
            proposta: {
              base_version_id: versaoId,
              explicacao: "A regra ganhou uma alternativa: oferecer parcelamento.",
              system_prompt: PROMPT_CORRIGIDO,
              mudancas_no_prompt: [{ o_que: "Alternativa ao desconto", por_que: "Proibição sem saída faz o agente ceder." }],
              materiais_novos: [],
              materiais_desligar: [],
              pacotes_ligar: [],
              pacotes_desligar: [],
              frases_de_passagem_adicionar: ["gerente"],
              frases_de_passagem_remover: [],
              mensagem_de_teste: "Me dá um desconto?",
            },
            verificacao: [],
            base: { id: versaoId, version_number: 1, partiu_do_rascunho: true, versao: null },
            materiais_ligados: [],
          },
        },
      }),
    );

    // ─── Do editor ao assistente, já no agente certo ──────────────────────
    await page.goto(`/app/ai/agents/${agentId}`);
    await page.getByTestId("agente-corrigir-com-ia").click();
    await page.waitForURL(new RegExp(`/app/ai/agents/criar-com-ia\\?modo=corrigir&agente=${agentId}`));
    await expect(page.getByTestId("correcao-agente")).toHaveValue(agentId);

    // ─── Relatar e diagnosticar ───────────────────────────────────────────
    const analisar = page.getByTestId("correcao-diagnosticar");
    await expect(analisar).toBeDisabled();
    await page.getByTestId("correcao-problema").fill(PROBLEMA);
    await analisar.click();
    await expect(page.getByTestId("correcao-diagnostico")).toContainText("Proibição sem alternativa", { timeout: 20_000 });

    // ─── Proposta: antes × depois, uma chave por mudança ──────────────────
    await page.getByTestId("correcao-propor").click();
    await expect(page.getByTestId("correcao-diff")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("correcao-diff-prompt")).toContainText("ofereça parcelar");
    await expect(page.getByTestId("correcao-mudanca")).toHaveCount(1);
    await page.screenshot({ path: ".superpowers/evidence/agente-corrigido-por-ia-proposta.png", fullPage: true });

    // ─── Salvar: vira rascunho ────────────────────────────────────────────
    await page.getByTestId("correcao-aplicar").click();
    await expect(page.getByTestId("correcao-pronto")).toBeVisible({ timeout: 20_000 });

    const versoes = (await (await page.request.get(`/api/v1/ai/agents/${agentId}/versions`)).json()) as {
      data: Array<{ id: string; status: string; system_prompt: string; handoff_keywords: string[]; change_summary: string | null }>;
    };
    expect(versoes.data.every((v) => v.status === "draft"), "nada foi publicado").toBe(true);
    const rascunho = versoes.data.find((v) => v.id === versaoId)!;
    expect(rascunho.system_prompt).toBe(PROMPT_CORRIGIDO);
    expect(rascunho.handoff_keywords).toContain("gerente");
    expect(rascunho.change_summary).toBe(`Correção com IA: ${PROBLEMA}`);

    // ─── O histórico do editor mostra de onde a versão veio ───────────────
    await page.getByTestId("correcao-abrir-editor").click();
    await page.goto(`/app/ai/agents/${agentId}?aba=historico`);
    await expect(page.getByTestId("versao-resumo-da-mudanca")).toContainText("Correção com IA");
    await page.screenshot({ path: ".superpowers/evidence/agente-corrigido-por-ia-historico.png", fullPage: true });
  });
});
