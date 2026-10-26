import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";
import { listConversationsQuerySchema } from "@/lib/schemas/messaging";

/**
 * O filtro de tag do inbox passou a ser pela tag do CONTATO (migration 0248):
 * é ela que o atendente aplica e que move o Kanban. E chega na grafia do
 * catálogo — "VIP" não pode virar "vip" no caminho, porque a comparação no
 * banco é exata.
 */

function clienteQueGrava() {
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "not", "is", "or", "order", "limit", "contains", "lt", "gt", "ilike"]) {
    q[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return q;
    };
  }
  q.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(res);
  return { chamadas, client: { from: () => q, rpc: async () => ({ data: null, error: null }) } };
}

const CTX = { organization_id: "org-1", actor: { type: "user" as const, id: "u-1" }, requestId: "r" };

describe("filtro de tag do inbox — tag do contato", () => {
  it("a grafia do catálogo atravessa o schema sem baixar a caixa", () => {
    const q = listConversationsQuerySchema.parse({ tag: " VIP " });
    expect(q.tag).toBe("VIP");
  });

  it("filtra contacts.tags com o embed !inner, e só quando há filtro", async () => {
    const com = clienteQueGrava();
    await listConversationsHandler(
      com.client as never,
      CTX,
      listConversationsQuerySchema.parse({ tag: "VIP" }),
    );
    const select = String(com.chamadas.find((c) => c.metodo === "select")!.args[0]);
    expect(select).toContain("contacts:contact_id!inner (");
    expect(com.chamadas).toContainEqual({ metodo: "contains", args: ["contacts.tags", ["VIP"]] });
    expect(com.chamadas).toContainEqual({ metodo: "eq", args: ["organization_id", "org-1"] });

    const sem = clienteQueGrava();
    await listConversationsHandler(sem.client as never, CTX, listConversationsQuerySchema.parse({}));
    const selectSem = String(sem.chamadas.find((c) => c.metodo === "select")!.args[0]);
    expect(selectSem).not.toContain("!inner");
    expect(sem.chamadas.some((c) => c.metodo === "contains")).toBe(false);
  });
});
