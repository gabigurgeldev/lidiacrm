/**
 * CANCELAR UMA EXECUÇÃO DE FLUXO.
 *
 * Nasceu de produção (2026-10-08): uma triagem armada por engano calava o
 * agente de IA até o cliente responder o menu inteiro. A rota precisa parar a
 * execução E as frentes (senão o acordador as encontra na próxima mensagem),
 * só tocar execução VIVA da organização da sessão, e dizer 409 para a que já
 * terminou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: vi.fn(() => true) }));

type Op = { tabela: string; tipo: "update" | "insert" | "select"; patch?: Record<string, unknown>; filtros: Record<string, unknown> };
let ops: Op[];
let execucaoViva: boolean;
let execucaoExiste: boolean;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const op: Op = { tabela, tipo: "select", filtros: {} };
      ops.push(op);
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        update: (patch: Record<string, unknown>) => ((op.tipo = "update"), (op.patch = patch), q),
        insert: async (linha: Record<string, unknown>) => ((op.tipo = "insert"), (op.patch = linha), { error: null }),
        select: () => q,
        eq: (c: string, v: unknown) => ((op.filtros[c] = v), q),
        in: (c: string, v: unknown) => ((op.filtros[c] = v), q),
        maybeSingle: async () => {
          if (op.tipo === "update") {
            return { data: execucaoViva ? { id: "exec-1", flow_id: "flow-1", current_node_id: "menu" } : null, error: null };
          }
          return { data: execucaoExiste ? { status: "completed" } : null, error: null };
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
      });
      return q;
    },
  }),
}));

import { requireRole } from "@/lib/auth/require-role";

const { POST } = await import("@/app/api/v1/flows/executions/[id]/cancel/route");

const ID = "7a2939d0-0000-4000-8000-000000000001";
const chamar = () => POST({} as never, { params: Promise.resolve({ id: ID }) });

describe("POST /api/v1/flows/executions/[id]/cancel", () => {
  beforeEach(() => {
    ops = [];
    execucaoViva = true;
    execucaoExiste = true;
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "user-1" },
      org: { orgId: "org-1" },
    } as never);
  });

  it("⭐ para a execução viva E as frentes, na organização da sessão", async () => {
    const r = await chamar();
    expect(r.status).toBe(200);

    const exec = ops.find((o) => o.tabela === "flow_executions" && o.tipo === "update")!;
    expect(exec.patch).toMatchObject({ status: "cancelled", next_eval_at: null });
    expect(exec.filtros).toMatchObject({ organization_id: "org-1", id: ID });
    expect(exec.filtros.status).toEqual(["pending", "running", "waiting", "paused"]);

    const frentes = ops.find((o) => o.tabela === "flow_execution_frames" && o.tipo === "update");
    expect(frentes, "frente esperando seguiria sendo acordada pela próxima mensagem").toBeDefined();
    expect(frentes!.patch).toMatchObject({ status: "cancelled", awaiting_event_type: null });
    expect(frentes!.filtros).toMatchObject({ organization_id: "org-1", execution_id: ID });

    const trilha = ops.find((o) => o.tabela === "flow_execution_events" && o.tipo === "insert");
    expect(trilha?.patch).toMatchObject({ event_type: "execucao_cancelada" });
  });

  it("execução que já terminou → 409, sem mexer em frente", async () => {
    execucaoViva = false;
    const r = await chamar();
    expect(r.status).toBe(409);
    expect(ops.some((o) => o.tabela === "flow_execution_frames")).toBe(false);
  });

  it("execução de outra organização (ou inexistente) → 404", async () => {
    execucaoViva = false;
    execucaoExiste = false;
    expect((await chamar()).status).toBe(404);
  });

  it("sem papel de gestor → a resposta do requireRole", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    expect((await chamar()).status).toBe(403);
  });
});
