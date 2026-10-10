import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * O EDITOR DE AGENTE EM SEÇÕES.
 *
 * O editor era um arquivo de 1.231 linhas com treze cartões em duas colunas
 * numa rolagem só. Virou uma coluna, com índice de seções ao lado, papéis num
 * segmentado e os ajustes que quase ninguém mexe atrás de "Ajustes avançados".
 *
 * O que cada caso vigia:
 *  - o índice não aponta para seção que não existe (link morto no índice é o
 *    defeito típico de quem reordena seções depois);
 *  - os avançados nascem fechados e abrem no clique;
 *  - um erro num campo avançado ABRE a seção sozinho — senão o Salvar fica
 *    bloqueado por um campo que o dono não vê;
 *  - os papéis continuam com os testids que as specs e2e clicam.
 *
 * Sabotagens medidas:
 *  - `mostrarAvancado = avancadoAberto` (sem `avancadoTemErro`) ⇒ "erro num
 *    campo avançado abre a seção" vermelho;
 *  - trocar o id da âncora `estilo` por `estilos` ⇒ "o índice só aponta para
 *    seções que existem" vermelho.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/a1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

afterEach(cleanup);

const CREDENCIAIS = [
  { id: "11111111-1111-4111-8111-111111111111", provider: "anthropic", label: "chave", is_active: true },
];
const SESSOES = [{ id: "22222222-2222-4222-8222-222222222222", display_name: "WhatsApp", phone_number: null, status: "WORKING" }];

const AGENTE = {
  id: "a1",
  organization_id: "org-1",
  name: "Vitoria",
  description: null,
  priority: 0,
  kind: "mcp_agent",
  published_version_id: "v1",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function versao(campos: Record<string, unknown> = {}) {
  return {
    id: "v1",
    organization_id: "org-1",
    agent_id: "a1",
    version_number: 1,
    status: "draft",
    system_prompt: "Você é a recepção da clínica. Atenda com educação.",
    provider: "anthropic",
    model: "claude-sonnet-5",
    credential_id: CREDENCIAIS[0]!.id,
    tool_ids: [],
    channel_session_id: SESSOES[0]!.id,
    max_steps: 10,
    token_budget: 50000,
    cost_budget_cents: 50,
    history_message_window: 20,
    history_token_window: 8000,
    handoff_keywords: [],
    handoff_tool_enabled: true,
    cases_enabled: false,
    split_messages: false,
    split_max_chars: 600,
    followup: { enabled: false, flow_pointer_ids: [] },
    operator_enabled: false,
    operator_model: null,
    operator_tool_ids: [],
    pipeline_ids: [],
    trigger_config: null,
    published_at: null,
    superseded_at: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: null,
    ...campos,
  };
}

function montar(props: { modo: "create" } | { modo: "edit"; versao: ReturnType<typeof versao> }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const comum = { credentials: CREDENCIAIS as never, channelSessions: SESSOES as never };
  render(
    <QueryClientProvider client={qc}>
      {props.modo === "create" ? (
        <AgentForm mode="create" {...comum} />
      ) : (
        <AgentForm
          mode="edit"
          {...comum}
          agent={AGENTE as never}
          draft={props.versao as never}
          published={null}
          base={props.versao as never}
        />
      )}
    </QueryClientProvider>,
  );
}

describe("editor de agente em seções", () => {
  it("o índice só aponta para seções que existem", () => {
    montar({ modo: "create" });
    const indice = screen.getByTestId("editor-indice");
    const alvos = within(indice)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href")!.slice(1));
    expect(alvos.length).toBeGreaterThanOrEqual(8);
    for (const alvo of alvos) {
      expect(document.getElementById(alvo), `o índice aponta para #${alvo}, que não existe`).not.toBeNull();
    }
  });

  it("os campos que o servidor exige estão à vista, sem abrir nada", () => {
    montar({ modo: "create" });
    for (const id of ["name", "model", "credential_id", "channel_session_id"]) {
      expect(document.getElementById(id), `#${id} escondido no editor`).not.toBeNull();
    }
  });

  it("ajustes avançados nascem fechados e abrem no clique", () => {
    montar({ modo: "create" });
    expect(document.getElementById("max_steps")).toBeNull();
    const botao = screen.getByTestId("editor-avancado");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("max_steps")).not.toBeNull();
    expect(document.getElementById("priority")).not.toBeNull();
  });

  it("erro num campo avançado abre a seção — o dono vê o que bloqueia o Salvar", () => {
    montar({ modo: "edit", versao: versao({ max_steps: 99 }) });
    expect(screen.getByTestId("editor-avancado")).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("max_steps")).toHaveAttribute("aria-invalid", "true");
  });

  it("os papéis são um segmentado com os testids que as specs clicam", () => {
    montar({ modo: "create" });
    const grupo = screen.getByRole("radiogroup", { name: "Papéis do agente" });
    expect(within(grupo).getAllByRole("radio").map((b) => b.getAttribute("data-testid"))).toEqual([
      "papel-conversa",
      "papel-operacao",
      "papel-seguranca",
    ]);
    fireEvent.click(screen.getByTestId("papel-seguranca"));
    expect(screen.getByTestId("papel-seguranca")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("editor-conversa")).toHaveClass("hidden");
  });
});
