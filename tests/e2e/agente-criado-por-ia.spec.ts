/**
 * "CRIAR AGENTE COM IA", PELA TELA.
 *
 * ## O que esta spec prova
 *
 * - A porta existe: "Criar com IA" na lista de Agentes leva à tela do construtor.
 * - A jornada inteira do lado da pessoa: contar sobre o negócio → responder uma
 *   rodada de perguntas (opção, sugestão aceita com um clique) → ver a prévia
 *   com o prompt, os materiais e o que ficou em aberto.
 * - Numa instalação sem número de WhatsApp (o estado do CI e de uma VPS recém
 *   instalada), a criação é BLOQUEADA com o caminho para conectar — e não um
 *   botão que falha depois.
 *
 * ## O que NÃO prova
 *
 * O modelo de verdade: o CI não tem chave de provedor de IA (ver
 * `flow-builder-ia.spec.ts`). As duas rotas de IA são interceptadas no
 * navegador com respostas no formato real (`{ data: … }`); a lógica delas é
 * provada nos testes de unidade (`app/api/v1/ai/agents/construtor/**`,
 * `lib/ai/agents/construtor/**`). A escrita (`construtor/criar`) não é
 * interceptada — e não é alcançada, porque sem número não há o que criar.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3041 pnpm exec playwright test tests/e2e/agente-criado-por-ia.spec.ts
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const PERGUNTAS = {
  data: {
    kind: "perguntar",
    nicho: "clinica",
    rodada: 1,
    max_rodadas: 3,
    perguntas: [
      {
        pergunta: "O preço da consulta pode ser dito no chat?",
        opcoes: ["Sim, o valor exato", "Só 'a partir de'", "Não, só com a equipe"],
        resposta_livre: false,
        sugestao: null,
      },
      {
        pergunta: "Quem atende quando o agente passa a conversa?",
        opcoes: [],
        resposta_livre: true,
        sugestao: "A recepção, das 8h às 18h",
      },
    ],
  },
};

const PRONTO = {
  data: { kind: "pronto", nicho: "clinica", rodada: 2, max_rodadas: 3, resumo: "Uma atendente que agenda consultas." },
};

const PREVIA = {
  data: {
    nicho: "clinica",
    materiais_falharam: false,
    pacotes_fora_do_teto: [],
    previa: {
      nome: "Bia, da Clínica Sorriso",
      descricao: "Agenda consultas e tira dúvidas.",
      system_prompt: "Quem você é:\nVocê é a Bia, assistente virtual da Clínica Sorriso.",
      pacotes: ["atender"],
      handoff_keywords: ["atendente"],
      lacunas: ["Valor do clareamento"],
      materiais: [
        {
          tipo: "faq",
          nome: "Perguntas frequentes",
          itens: [{ pergunta: "Vocês abrem sábado?", resposta: "Sim, das 8h às 12h." }],
        },
      ],
    },
  },
};

test.describe("criar agente com IA", () => {
  test("da lista de Agentes até a prévia; sem número, a criação diz como conectar", async ({ page }) => {
    let entrevistas = 0;
    const corpos: unknown[] = [];
    await page.route("**/api/v1/ai/agents/construtor/entrevistar", async (route) => {
      corpos.push(route.request().postDataJSON());
      entrevistas += 1;
      await route.fulfill({ json: entrevistas === 1 ? PERGUNTAS : PRONTO });
    });
    await page.route("**/api/v1/ai/agents/construtor/gerar", (route) => route.fulfill({ json: PREVIA }));

    await loginComoAdmin(page, lerCreds());
    await page.goto("/app/ai/agents");
    await page.getByTestId("agentes-criar-com-ia").first().click();
    await page.waitForURL(/\/app\/ai\/agents\/criar-com-ia/);

    // ─── Contar ───────────────────────────────────────────────────────────
    const comecar = page.getByTestId("construtor-comecar");
    await expect(comecar).toBeDisabled();
    await page
      .getByTestId("construtor-material")
      .fill("Somos a Clínica Sorriso, em Curitiba. Atendemos de segunda a sábado. Consulta R$ 200.");
    await comecar.click();

    // ─── Perguntas: opção + sugestão aceita com um clique ─────────────────
    await expect(page.getByTestId("construtor-pergunta")).toHaveCount(2, { timeout: 20_000 });
    await page.getByRole("radio", { name: "Só 'a partir de'" }).click();
    await page.getByRole("button", { name: /A recepção, das 8h às 18h/ }).click();
    await page.getByTestId("construtor-enviar-respostas").click();

    // ─── Revisar ──────────────────────────────────────────────────────────
    await expect(page.getByTestId("construtor-revisao")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("construtor-nome")).toHaveValue("Bia, da Clínica Sorriso");
    await expect(page.getByTestId("construtor-prompt")).toHaveValue(/assistente virtual da Clínica Sorriso/);
    await expect(page.getByText("Valor do clareamento")).toBeVisible();
    await expect(page.getByTestId("construtor-material-item")).toHaveCount(1);
    await expect(page.getByTestId("construtor-contagem-ferramentas")).toContainText("/ 25");

    // As respostas chegaram ao servidor como histórico de pergunta/resposta.
    const segunda = corpos[1] as { historico: Array<{ papel: string; texto: string }>; rodada: number };
    expect(segunda.rodada).toBe(2);
    expect(segunda.historico.map((f) => f.texto)).toEqual([
      "O preço da consulta pode ser dito no chat?",
      "Só 'a partir de'",
      "Quem atende quando o agente passa a conversa?",
      "A recepção, das 8h às 18h",
    ]);

    // ─── Sem número de WhatsApp: bloqueado, com o caminho para conectar ───
    const semCanal = page.getByRole("link", { name: "Conectar WhatsApp" });
    if (await semCanal.isVisible()) {
      await expect(page.getByTestId("construtor-criar")).toBeDisabled();
    } else {
      await expect(page.getByTestId("construtor-canal")).toBeVisible();
      await expect(page.getByTestId("construtor-criar")).toBeEnabled();
    }
    await page.screenshot({ path: ".superpowers/evidence/agente-criado-por-ia-revisao.png", fullPage: true });
  });
});
