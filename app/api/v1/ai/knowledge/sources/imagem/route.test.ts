// @vitest-environment node
// Multipart real precisa do realm do Node (ver ai/skills/import/route.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/ai/knowledge/sources/imagem — a foto que entra no acervo.
 *
 *  - formato fora de jpeg/png/webp é 415, e um arquivo cujos BYTES não são
 *    foto também (o `type` vem do navegador, isto é, do cliente);
 *  - acima de 5 MB é 413;
 *  - sem nome ou sem descrição é 422 — e nada sobe ao bucket;
 *  - o caminho é `{org da SESSÃO}/materiais/{uuid}.{ext do formato}`;
 *  - 201 grava `source_type='imagem'` com o metadata do contrato, emite o
 *    evento que o indexador consome e audita;
 *  - nome repetido (23505) é 409 e APAGA o arquivo que já tinha subido.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { caminhoDeMaterialValido } from "@/lib/ai/rag/imagem";

import { POST } from "./route";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const KS_ID = "33333333-3333-4333-8333-333333333333";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

interface Dublagem {
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  inseridas: Array<Record<string, unknown>>;
}

function dublarAdmin(erroDoInsert: { code?: string; message: string } | null = null): Dublagem {
  const upload = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ error: null }));
  const inseridas: Array<Record<string, unknown>> = [];
  admin.mockReturnValue({
    storage: { from: () => ({ upload, remove }) },
    from: () => ({
      insert: (linha: Record<string, unknown>) => {
        inseridas.push(linha);
        return {
          select: () => ({
            single: async () => ({ data: erroDoInsert ? null : { id: KS_ID }, error: erroDoInsert }),
          }),
        };
      },
    }),
    rpc,
  });
  return { upload, remove, rpc, inseridas };
}

function chamar(campos: { file?: File; name?: string; descricao?: string }) {
  const form = new FormData();
  if (campos.file) form.append("file", campos.file);
  if (campos.name !== undefined) form.append("name", campos.name);
  if (campos.descricao !== undefined) form.append("descricao", campos.descricao);
  return POST(
    new NextRequest("http://x/api/v1/ai/knowledge/sources/imagem", { method: "POST", body: form }),
  );
}

const foto = (bytes: Uint8Array<ArrayBuffer>, nome = "rosa.jpg", type = "image/jpeg") =>
  new File([bytes], nome, { type });

const VALIDO = { name: "Buquê de rosas", descricao: "Buquê com 12 rosas vermelhas e laço dourado." };

beforeEach(() => {
  admin.mockReset();
  vi.mocked(audit).mockClear();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
    user: { id: USER_ID },
  } as never);
});

describe("POST /api/v1/ai/knowledge/sources/imagem — recusas", () => {
  it("quem não passa no papel não envia nada", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { upload } = dublarAdmin();
    const res = await chamar({ file: foto(JPEG), ...VALIDO });
    expect(res.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it("formato que não é foto → 415", async () => {
    const { upload } = dublarAdmin();
    const res = await chamar({ file: foto(JPEG, "a.gif", "image/gif"), ...VALIDO });
    expect(res.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });

  it("type de foto com bytes de outra coisa → 415 (o type vem do navegador)", async () => {
    const { upload } = dublarAdmin();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await chamar({ file: foto(html, "rosa.jpg", "image/jpeg"), ...VALIDO });
    expect(res.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });

  it("acima de 5 MB → 413", async () => {
    const { upload } = dublarAdmin();
    const grande = new Uint8Array(5 * 1024 * 1024 + 1);
    grande.set(JPEG);
    const res = await chamar({ file: foto(grande), ...VALIDO });
    expect(res.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it("sem descrição → 422, e a mensagem diz por que ela importa", async () => {
    const { upload } = dublarAdmin();
    const res = await chamar({ file: foto(JPEG), name: VALIDO.name, descricao: "  " });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toContain("descrição");
    expect(upload).not.toHaveBeenCalled();
  });

  it("sem nome → 422; sem arquivo → 422", async () => {
    const { upload } = dublarAdmin();
    expect((await chamar({ file: foto(JPEG), descricao: VALIDO.descricao })).status).toBe(422);
    expect((await chamar({ ...VALIDO })).status).toBe(422);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/ai/knowledge/sources/imagem — sucesso", () => {
  it("201: sobe na pasta de materiais da org da sessão, grava o contrato, emite e audita", async () => {
    const { upload, rpc, inseridas } = dublarAdmin();
    const res = await chamar({ file: foto(PNG, "cartela.png", "image/png"), ...VALIDO });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(KS_ID);

    const [caminho, , opcoes] = upload.mock.calls[0] as [string, unknown, { contentType: string }];
    expect(caminho.startsWith(`${ORG_ID}/materiais/`)).toBe(true);
    expect(caminho.endsWith(".png")).toBe(true);
    // O caminho gravado é o MESMO que a leitura e o envio aceitam assinar.
    expect(caminhoDeMaterialValido(caminho, ORG_ID)).toBe(true);
    expect(opcoes.contentType).toBe("image/png");

    expect(inseridas).toHaveLength(1);
    expect(inseridas[0]).toMatchObject({
      organization_id: ORG_ID,
      source_type: "imagem",
      name: VALIDO.name,
      source_metadata: {
        blob_path: caminho,
        mime_type: "image/png",
        size_bytes: PNG.length,
        filename: "cartela.png",
        descricao: VALIDO.descricao,
        uploaded_by: USER_ID,
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: "knowledge_source.updated",
        p_entity_id: KS_ID,
        p_organization_id: ORG_ID,
        p_payload: expect.objectContaining({ knowledge_source_id: KS_ID, source_type: "imagem" }),
      }),
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_knowledge.image_uploaded",
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        resourceId: KS_ID,
      }),
    );
  });

  it("nome repetido (23505) → 409 e o arquivo enviado é apagado", async () => {
    const { upload, remove, rpc } = dublarAdmin({
      code: "23505",
      message: 'duplicate key value violates unique constraint "ai_knowledge_sources_nome_unico_por_org"',
    });
    const res = await chamar({ file: foto(JPEG), ...VALIDO });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("knowledge_source_name_in_use");
    expect(body.error.message).not.toContain("constraint");

    const [caminho] = upload.mock.calls[0] as [string];
    expect(remove).toHaveBeenCalledWith([caminho]);
    expect(rpc).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
