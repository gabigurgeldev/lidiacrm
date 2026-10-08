/**
 * O EDITOR DO AGENTE SALVA O QUE MOSTRA — E DIZ POR QUE NÃO PUBLICA.
 *
 * Três defeitos da mesma tela:
 *
 *  1. Nome, descrição e ordem de preferência mudavam no formulário, o toast dizia
 *     "Rascunho salvo", e nada ia para o banco: o nome voltava no próximo
 *     carregamento. Agora a identidade vai junto, e renomear não cria rascunho.
 *  2. "A chave desta instalação" salvava e travava o Publicar para sempre ("Escolha
 *     a chave de acesso…") — inclusive no agente criado pelo onboarding.
 *  3. O motivo do Publicar travado ficava só no `title` do botão: invisível no
 *     celular. Agora aparece escrito.
 *
 * Sabotagens medidas: mandar sempre o payload da versão → o 1º caso reprova;
 * tirar `usaChaveDaInstalacao` do motivo → o 2º reprova; tirar o parágrafo
 * `motivo-do-publicar` → o 3º reprova.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const salvar = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/a1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/app/app/ai/agents/[id]/_actions", () => ({
  saveAgentDraftAction: (...args: unknown[]) => salvar(...args),
  publishAgentAction: vi.fn(),
  createMcpAgentAction: vi.fn(),
}));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

const SESSOES = [{ id: "22222222-2222-4222-8222-222222222222", label: "WhatsApp", status: "WORKING" }];

const AGENTE = {
  id: "a1",
  organization_id: "org-1",
  name: "Vitoria",
  description: null,
  priority: 0,
  model: "claude-sonnet-5",
  system_prompt: "Você é a Vitória, da recepção.",
  is_active: false,
  is_default: false,
  config: {},
  guardrails: [],
  active_kb_version_id: null,
  kind: "mcp_agent",
  published_version_id: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function rascunho(credentialId: string | null) {
  return {
    id: "v1",
    organization_id: "org-1",
    agent_id: "a1",
    version_number: 1,
    status: "draft",
    system_prompt: "Você é a Vitória, da recepção da Clínica Vitalis.",
    provider: "anthropic",
    model: "claude-sonnet-5",
    credential_id: credentialId,
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
  };
}

function abre(opts: { credentialId: string | null; provedoresDaInstalacao: string[] }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const v = rascunho(opts.credentialId);
  return render(
    <QueryClientProvider client={qc}>
      <AgentForm
        mode="edit"
        agent={AGENTE as never}
        credentials={[] as never}
        provedoresDaInstalacao={opts.provedoresDaInstalacao}
        channelSessions={SESSOES as never}
        draft={v as never}
        published={null}
        base={v as never}
        draftObsoleto={null}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  salvar.mockReset();
  salvar.mockResolvedValue({ ok: true, data: { version_id: null, version_number: null } });
});

describe("o editor salva o que mostra", () => {
  it("renomear salva a identidade do agente — e não cria rascunho", async () => {
    const { container } = abre({ credentialId: null, provedoresDaInstalacao: ["anthropic"] });
    const nome = container.querySelector("#name") as HTMLInputElement;
    fireEvent.change(nome, { target: { value: "Vitória da Recepção" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar rascunho/i }));

    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar).toHaveBeenCalledWith("a1", null, {
      name: "Vitória da Recepção",
      description: null,
      priority: 0,
    });
  });
});

describe("a chave desta instalação publica", () => {
  it("com a chave do provedor na instalação, o Publicar não fica travado", () => {
    abre({ credentialId: null, provedoresDaInstalacao: ["anthropic"] });
    expect(screen.queryByTestId("motivo-do-publicar")).toBeNull();
    expect(screen.getByRole("button", { name: /publicar v1/i })).toBeEnabled();
  });

  it("sem a chave na instalação, o motivo aparece ESCRITO na tela", () => {
    abre({ credentialId: null, provedoresDaInstalacao: [] });
    expect(screen.getByTestId("motivo-do-publicar")).toHaveTextContent(/para publicar/i);
    expect(screen.getByRole("button", { name: /publicar v1/i })).toBeDisabled();
  });
});
