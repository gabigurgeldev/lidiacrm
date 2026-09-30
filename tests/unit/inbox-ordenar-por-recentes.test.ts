/**
 * ORDENAR A LISTA DO INBOX.
 *
 * A Fila sai por quem espera há mais tempo — é para isso que ela existe. Mas o
 * atendente às vezes quer ver o que acabou de chegar, na Fila ou em qualquer
 * aba. O `sort` escolhe; ausente, cada aba segue a ordem de sempre.
 *
 * A cadeia inteira é vigiada porque o filtro por tag já rompeu no meio dela
 * (a rota não lia o param — ver `inbox-filtro-de-tag.test.ts`): a ROTA tem de
 * repassar, o HANDLER tem de ordenar, e o CURSOR não pode ser reaproveitado
 * entre ordens (compararia `last_message_at` com `last_inbound_at` e devolveria
 * uma página errada sem erro).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listConversationsQuerySchema } from "@/lib/schemas/messaging";

// ---------------------------------------------------------------------------
// Handler: um query builder que só grava o que foi pedido.
// ---------------------------------------------------------------------------

type Chamada = [string, ...unknown[]];

function builder(linhas: Record<string, unknown>[] = []) {
  const chamadas: Chamada[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "not", "contains", "is", "ilike", "or", "gt", "lt"]) {
    q[m] = (...a: unknown[]) => {
      chamadas.push([m, ...a]);
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown) => ok({ data: linhas, error: null });
  const supabase = { from: () => q };
  return { supabase, chamadas };
}

const ctx = {
  organization_id: "org-1",
  requestId: "r",
  actor: { type: "user", id: "u-1" },
} as never;

async function listar(query: Record<string, unknown>, linhas: Record<string, unknown>[] = []) {
  const { listConversationsHandler } = await import("@/app/api/v1/conversations/_handler");
  const { supabase, chamadas } = builder(linhas);
  const q = listConversationsQuerySchema.parse(query);
  const r = await listConversationsHandler(supabase as never, ctx, q);
  return { r, ordens: chamadas.filter((c) => c[0] === "order") };
}

describe("handler — a ordem da lista", () => {
  it("Fila sem escolha: quem espera há mais tempo primeiro", async () => {
    const { ordens } = await listar({ assigned_to: "unassigned" });
    expect(ordens[0]).toEqual(["order", "last_inbound_at", { ascending: true, nullsFirst: false }]);
  });

  it("Fila com `recentes`: última mensagem primeiro", async () => {
    const { ordens } = await listar({ assigned_to: "unassigned", sort: "recentes" });
    expect(ordens[0]).toEqual(["order", "last_message_at", { ascending: false, nullsFirst: false }]);
  });

  it("Todas sem escolha: segue por atividade recente", async () => {
    const { ordens } = await listar({});
    expect(ordens[0]).toEqual(["order", "last_message_at", { ascending: false, nullsFirst: false }]);
  });

  it("Todas com `espera`: vira a ordem da fila", async () => {
    const { ordens } = await listar({ sort: "espera" });
    expect(ordens[0]).toEqual(["order", "last_inbound_at", { ascending: true, nullsFirst: false }]);
  });

  it("valor desconhecido é recusado, não ignorado", () => {
    expect(listConversationsQuerySchema.safeParse({ sort: "alfabetica" }).success).toBe(false);
  });
});

describe("handler — cursor preso à ordem que o emitiu", () => {
  const linhas = Array.from({ length: 3 }, (_, i) => ({
    id: `c${i}`,
    last_message_at: `2026-09-0${i + 1}T00:00:00Z`,
    last_inbound_at: `2026-08-0${i + 1}T00:00:00Z`,
  }));

  it("cursor de `recentes` reaplicado em `espera` é recusado", async () => {
    const { r } = await listar({ sort: "recentes", limit: 2 }, linhas);
    expect(r.cursor).toBeTruthy();
    await expect(listar({ sort: "espera", cursor: r.cursor })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });

  it("controle: o mesmo cursor na mesma ordem pagina", async () => {
    const { r } = await listar({ sort: "recentes", limit: 2 }, linhas);
    await expect(listar({ sort: "recentes", cursor: r.cursor })).resolves.toBeTruthy();
  });

  it("cursor antigo, sem coluna gravada, continua aceito", async () => {
    const antigo = Buffer.from(JSON.stringify({ sort: "2026-09-01T00:00:00Z", id: "c0" })).toString(
      "base64url",
    );
    await expect(listar({ sort: "espera", cursor: antigo })).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Rota: o `sort` da query string chega ao handler.
// ---------------------------------------------------------------------------

describe("GET /api/v1/conversations — `sort` chega ao handler", () => {
  const handler = vi.fn(async () => ({ conversations: [], cursor: null, has_more: false }));

  beforeEach(() => {
    vi.resetModules();
    handler.mockClear();
    vi.doMock("@/app/api/v1/conversations/_handler", () => ({ listConversationsHandler: handler }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
      }),
    }));
    vi.doMock("@/lib/auth/server", () => ({
      mfaEmDivida: vi.fn(async () => false),
      loadAuthUser: async () => ({ id: "u-1" }),
      resolveActiveOrg: async () => ({ orgId: "org-1", role: "agent" }),
    }));
  });

  async function recebido(qs: string) {
    const { GET } = await import("@/app/api/v1/conversations/route");
    await GET(new NextRequest(`http://x/api/v1/conversations${qs}`));
    const chamada = handler.mock.calls.at(-1) as unknown[] | undefined;
    if (!chamada) throw new Error("o handler não foi chamado");
    return chamada[2] as Record<string, unknown>;
  }

  it("`?sort=recentes` chega", async () => {
    expect((await recebido("?sort=recentes")).sort).toBe("recentes");
  });

  it("sem `sort`, chega undefined (a aba decide)", async () => {
    expect((await recebido("")).sort).toBeUndefined();
  });
});
