import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { publicarPolitica } from "@/lib/coordenador/painel";

/**
 * POST /api/v1/ai/coordenador — publicar a política.
 *
 *  - GATE: só admin publica (o requireRole decide; a rota não confia no corpo).
 *  - CORPO: o MESMO `politicaSchema` da tela; regra que aponta para destino
 *    que não existe é 422, e nada é publicado.
 *  - ESCOPO: esta rota publica a política da ORGANIZAÇÃO — política de número
 *    no corpo é recusada.
 *  - EFEITO: publica com a org e o autor da SESSÃO e audita
 *    `coordenador.politica_publicada`.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/coordenador/painel", () => ({ publicarPolitica: vi.fn(), lerPainel: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENTE = "33333333-3333-4333-8333-333333333333";

const politicaValida = {
  modo: "shadow",
  channel_session_id: null,
  config: { destino_padrao: "comercial" },
  destinos: [{ chave: "comercial", tipo: "agente", agent_id: AGENTE }],
};

async function publicar(corpo: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://x/api/v1/ai/coordenador", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(publicarPolitica).mockReset();
  vi.mocked(audit).mockClear();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG, role: "admin" },
  } as never);
  vi.mocked(publicarPolitica).mockResolvedValue({ ok: true, versaoId: "v1", numero: 3 });
});

describe("POST /api/v1/ai/coordenador", () => {
  it("exige admin — e quem não é não chega a publicar", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const r = await publicar(politicaValida);
    expect(r.status).toBe(403);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("admin");
    expect(publicarPolitica).not.toHaveBeenCalled();
  });

  it("regra que aponta para destino inexistente é 422, e nada é publicado", async () => {
    const r = await publicar({
      ...politicaValida,
      config: { regras_de_entrada: [{ id: "r1", quando: "contem", termos: ["plano"], destino: "fantasma" }] },
    });
    expect(r.status).toBe(422);
    expect(publicarPolitica).not.toHaveBeenCalled();
  });

  it("política de NÚMERO não se publica por esta rota", async () => {
    const r = await publicar({ ...politicaValida, channel_session_id: "44444444-4444-4444-8444-444444444444" });
    expect(r.status).toBe(422);
    expect(publicarPolitica).not.toHaveBeenCalled();
  });

  it("publica com a org e o autor da SESSÃO e audita a versão", async () => {
    const r = await publicar(politicaValida);
    expect(r.status).toBe(201);
    expect(publicarPolitica).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, userId: USER, politica: expect.objectContaining({ modo: "shadow" }) }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "coordenador.politica_publicada",
        organizationId: ORG,
        resourceId: "v1",
        metadata: expect.objectContaining({ numero: 3, modo: "shadow", destinos: 1 }),
      }),
    );
  });

  it("agente de outra organização: 422 com a frase que a tela mostra", async () => {
    vi.mocked(publicarPolitica).mockResolvedValue({ ok: false, motivo: "destino_de_outra_organizacao" });
    const r = await publicar(politicaValida);
    expect(r.status).toBe(422);
    expect(audit).not.toHaveBeenCalled();
  });
});
