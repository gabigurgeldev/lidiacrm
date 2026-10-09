/**
 * Modelos de agente por tipo de negócio.
 *
 * O que cada caso vigia:
 *  - todo ramo do quadro pronto do onboarding tem modelo (um vocabulário de
 *    ramos só);
 *  - todo modelo, em todo jeito de falar, vira uma versão que o servidor ACEITA
 *    — um modelo que preenche o formulário com algo que o Criar recusa é pior
 *    que nenhum;
 *  - o texto começa pelo MESMO jeito de falar do agente do onboarding;
 *  - as palavras de sempre ("falar com humano"…) continuam lá, somadas às do
 *    ramo;
 *  - URL desconhecida abre em branco, não quebra;
 *  - o formulário de novo agente nasce com o que o modelo preencheu.
 *
 * Sabotagens medidas:
 *  - `montarModelo` sem `PALAVRAS_DE_SEMPRE` ⇒ "as palavras de sempre" vermelho;
 *  - `AgentForm` sem `...props.inicial` ⇒ "o formulário nasce preenchido" vermelho.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";
import { PROMPT_TEMPLATES } from "@/lib/schemas/onboarding";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import {
  MODELOS_DE_AGENTE,
  escolhaDaUrl,
  montarModelo,
} from "@/lib/ai/agents/modelos-por-nicho";
import { JEITOS_DE_FALAR, PROMPT_BODIES } from "@/lib/ai/agents/tons";
import { buildState, toVersionPayload } from "@/app/app/ai/agents/[id]/_components/editor/estado";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";
import { EscolhaDeModelo } from "@/app/app/ai/agents/new/_components/EscolhaDeModelo";

afterEach(cleanup);

// As capacidades REAIS que a página passa: um id inventado seria recusado pelo servidor.
const CTX = { onde: "Clínica Sorriso, que é: odontologia", capacidades: capacidadesPadraoDoOnboarding() };

describe("modelos por ramo", () => {
  it("todo ramo do quadro pronto tem um modelo, na mesma ordem", () => {
    expect(MODELOS_DE_AGENTE.map((m) => m.id)).toEqual(PACOTES.map((p) => p.id));
    for (const m of MODELOS_DE_AGENTE) {
      expect(m.nuncaFaz.length, `${m.id} sem "nunca faz"`).toBeGreaterThan(0);
      expect(m.quandoPassar.length, `${m.id} sem "quando chamar uma pessoa"`).toBeGreaterThan(0);
    }
  });

  it("todo modelo, em todo jeito de falar, vira uma versão que o servidor aceita", () => {
    for (const m of MODELOS_DE_AGENTE) {
      for (const tom of PROMPT_TEMPLATES) {
        const campos = montarModelo(m, tom, CTX);
        const versao = toVersionPayload({
          ...buildState({ version: null }),
          ...campos,
          model: "claude-sonnet-5",
          credential_id: "11111111-1111-4111-8111-111111111111",
          channel_session_id: "22222222-2222-4222-8222-222222222222",
        });
        const r = versionCreateSchema.safeParse(versao);
        expect(r.success, `${m.id}/${tom}: ${JSON.stringify(r.error?.flatten().fieldErrors)}`).toBe(true);
      }
    }
  });

  it("o texto começa pelo mesmo jeito de falar do agente do onboarding", () => {
    const campos = montarModelo(MODELOS_DE_AGENTE[0]!, "support_minimal", CTX);
    expect(campos.system_prompt.startsWith(PROMPT_BODIES.support_minimal(CTX.onde))).toBe(true);
    expect(campos.system_prompt).toContain("## O que você nunca faz");
  });

  it("as palavras de sempre continuam, somadas às do ramo", () => {
    const clinica = MODELOS_DE_AGENTE.find((m) => m.id === "clinica")!;
    const { handoff_keywords } = montarModelo(clinica, "ecommerce_friendly", CTX);
    expect(handoff_keywords).toEqual(expect.arrayContaining(["falar com humano", "atendente", "pessoa real", "urgência"]));
    expect(new Set(handoff_keywords).size).toBe(handoff_keywords.length);
  });

  it("URL desconhecida abre em branco, com o tom padrão", () => {
    expect(escolhaDaUrl({ modelo: "nao-existe", tom: "berrando" })).toEqual({ modelo: null, tom: PROMPT_TEMPLATES[0] });
    expect(escolhaDaUrl({ modelo: ["loja"], tom: "support_minimal" }).modelo?.id).toBe("loja");
  });
});

describe("na tela de novo agente", () => {
  it("cada modelo é um link que leva o modelo e o tom; o escolhido aparece marcado", () => {
    render(
      <EscolhaDeModelo
        modelos={MODELOS_DE_AGENTE}
        jeitos={JEITOS_DE_FALAR}
        modelo="imobiliaria"
        tom="ecommerce_professional"
      />,
    );
    expect(screen.getByTestId("modelo-clinica")).toHaveAttribute(
      "href",
      "/app/ai/agents/new?modelo=clinica&tom=ecommerce_professional",
    );
    expect(within(screen.getByTestId("modelo-imobiliaria")).getByLabelText("Em uso")).toBeInTheDocument();
    expect(within(screen.getByTestId("modelo-clinica")).queryByLabelText("Em uso")).toBeNull();
    expect(screen.getByTestId("tom-ecommerce_professional")).toHaveAttribute("aria-checked", "true");
  });

  it("o formulário nasce preenchido com o modelo", () => {
    const campos = montarModelo(MODELOS_DE_AGENTE.find((m) => m.id === "curso")!, "ecommerce_friendly", CTX);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AgentForm mode="create" inicial={campos} credentials={[]} channelSessions={[]} />
      </QueryClientProvider>,
    );
    expect(document.getElementById("name")).toHaveValue(campos.name);
    const prompt = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA" && el.className.includes("font-mono")) as HTMLTextAreaElement;
    expect(prompt.value).toBe(campos.system_prompt);
  });
});
