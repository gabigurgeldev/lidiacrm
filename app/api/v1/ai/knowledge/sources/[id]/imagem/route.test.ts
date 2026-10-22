// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/v1/ai/knowledge/sources/[id]/imagem — a miniatura da foto.
 *
 * Quem assina a URL é a service role, e `source_metadata` é jsonb que um
 * manager escreve pela REST. Então a rota só assina quando TRÊS coisas valem:
 * o material é desta organização, é do tipo foto, e o caminho é uma foto da
 * pasta de materiais DESTA organização. Qualquer outra coisa é 404 — e o
 * Storage nem é chamado.
 */

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const KS_ID = "33333333-3333-4333-8333-333333333333";
const ARQUIVO = "44444444-4444-4444-8444-444444444444";
const CAMINHO = `${ORG_ID}/materiais/${ARQUIVO}.jpg`;

/**
 * O client de sessão devolve a linha só quando o filtro de organização bate —
 * é o que a RLS e o `.eq("organization_id")` fazem juntos de verdade.
 */
function dublarLeitura(linha: { organization_id: string; source_type: string; source_metadata: unknown } | null) {
  const filtros: Record<string, unknown> = {};
  const cadeia = {
    select: () => cadeia,
    eq: (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return cadeia;
    },
    maybeSingle: async () => ({
      data: linha && filtros.organization_id === linha.organization_id ? { id: KS_ID, ...linha } : null,
      error: null,
    }),
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => cadeia } as never);
}

function dublarAssinatura() {
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: "https://storage.example/assinada?token=x" },
    error: null,
  }));
  admin.mockReturnValue({ storage: { from: () => ({ createSignedUrl }) } });
  return createSignedUrl;
}

const chamar = () =>
  GET(new NextRequest(`http://x/api/v1/ai/knowledge/sources/${KS_ID}/imagem`), {
    params: Promise.resolve({ id: KS_ID }),
  });

beforeEach(() => {
  admin.mockReset();
  vi.mocked(loadAuthUser).mockResolvedValue({ id: "u" } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "viewer" } as never);
});

describe("GET /api/v1/ai/knowledge/sources/[id]/imagem", () => {
  it("302 para a URL assinada por 300 s", async () => {
    dublarLeitura({ organization_id: ORG_ID, source_type: "imagem", source_metadata: { blob_path: CAMINHO } });
    const assinar = dublarAssinatura();

    const res = await chamar();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/assinada?token=x");
    expect(assinar).toHaveBeenCalledWith(CAMINHO, 300);
  });

  it("material de OUTRA organização → 404, sem assinar nada", async () => {
    dublarLeitura({ organization_id: OUTRA_ORG, source_type: "imagem", source_metadata: { blob_path: CAMINHO } });
    const assinar = dublarAssinatura();

    expect((await chamar()).status).toBe(404);
    expect(assinar).not.toHaveBeenCalled();
  });

  it("material que não é foto → 404", async () => {
    dublarLeitura({
      organization_id: ORG_ID,
      source_type: "documento",
      source_metadata: { blob_path: CAMINHO },
    });
    const assinar = dublarAssinatura();

    expect((await chamar()).status).toBe(404);
    expect(assinar).not.toHaveBeenCalled();
  });

  it.each([
    ["de outra organização", `${OUTRA_ORG}/materiais/${ARQUIVO}.jpg`],
    ["de uma conversa", `${ORG_ID}/conversa-1/${ARQUIVO}.jpg`],
    ["com ..", `${ORG_ID}/materiais/../${OUTRA_ORG}/materiais/${ARQUIVO}.jpg`],
    ["sem caminho", undefined],
  ])("blob_path trocado (%s) → 404, sem assinar", async (_rotulo, caminho) => {
    dublarLeitura({ organization_id: ORG_ID, source_type: "imagem", source_metadata: { blob_path: caminho } });
    const assinar = dublarAssinatura();

    expect((await chamar()).status).toBe(404);
    expect(assinar).not.toHaveBeenCalled();
  });

  it("sem sessão → 401", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(null as never);
    expect((await chamar()).status).toBe(401);
  });
});
