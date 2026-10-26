import { describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { NextRequest } from "next/server";

import { GET, POST } from "./route";

/**
 * Atendente APLICA tag; quem cria é manager+ (decisão do produto, 2026-10-26).
 * A rota tem de pedir o papel certo a `requireRole` — e respeitar a recusa.
 */

function negado() {
  return { ok: false, response: new Response(null, { status: 403 }) };
}

describe("/api/v1/tags — papel", () => {
  it("POST exige manager e devolve a recusa sem tocar no banco", async () => {
    requireRole.mockReset().mockResolvedValue(negado());
    const res = await POST(
      new NextRequest("http://x/api/v1/tags", { method: "POST", body: JSON.stringify({ name: "VIP" }) }),
    );
    expect(res.status).toBe(403);
    expect(requireRole.mock.calls[0]![0]).toBe("manager");
  });

  it("GET é leitura de qualquer papel (viewer+)", async () => {
    requireRole.mockReset().mockResolvedValue(negado());
    await GET(new NextRequest("http://x/api/v1/tags"));
    expect(requireRole.mock.calls[0]![0]).toBe("viewer");
  });
});
