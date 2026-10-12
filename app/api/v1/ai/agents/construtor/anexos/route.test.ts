// @vitest-environment node
// Multipart real precisa do realm do Node (ver ai/skills/import/route.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/ai/agents/construtor/anexos
 *
 *  - quem não é admin não lê nada;
 *  - devolve o TEXTO de cada arquivo e não grava nada (não há cliente de banco
 *    nem de Storage nesta rota — o mock abaixo prova que ninguém o chamou);
 *  - tipo desconhecido e arquivo ilegível voltam como falha POR ARQUIVO, sem
 *    derrubar os outros;
 *  - texto longo é cortado, e a resposta diz que cortou;
 *  - mais de 5 arquivos é 422.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));

import { requireRole } from "@/lib/auth/require-role";
import { TETO_POR_ANEXO } from "@/lib/ai/agents/construtor/esquemas";

import { POST } from "./route";

function chamar(arquivos: File[]) {
  const form = new FormData();
  for (const f of arquivos) form.append("arquivos", f);
  return POST(new NextRequest("http://x/api/v1/ai/agents/construtor/anexos", { method: "POST", body: form }));
}

const txt = (nome: string, conteudo: string) => new File([conteudo], nome, { type: "text/plain" });

beforeEach(() => {
  admin.mockReset();
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: "org-1" }, user: { id: "u" } } as never);
});

describe("anexos do construtor", () => {
  it("quem não é admin não lê nada", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const res = await chamar([txt("a.txt", "Preço da consulta: R$ 200.")]);
    expect(res.status).toBe(403);
  });

  it("devolve o texto de cada arquivo e não grava nada", async () => {
    const res = await chamar([txt("precos.txt", "Consulta: R$ 200."), txt("faq.md", "# Dúvidas\nAbre sábado.")]);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { anexos: Array<Record<string, unknown>> } };
    expect(data.anexos).toEqual([
      { nome: "precos.txt", ok: true, texto: "Consulta: R$ 200.", chars: 17, truncado: false },
      expect.objectContaining({ nome: "faq.md", ok: true, truncado: false }),
    ]);
    expect(admin).not.toHaveBeenCalled();
  });

  it("tipo desconhecido e PDF ilegível falham por arquivo, sem derrubar os outros", async () => {
    const res = await chamar([
      new File(["\x00\x01"], "planilha.xlsx", { type: "application/vnd.ms-excel" }),
      new File(["isto não é um PDF"], "quebrado.pdf", { type: "application/pdf" }),
      txt("ok.txt", "Horário: 8h às 18h."),
    ]);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { anexos: Array<{ nome: string; ok: boolean }> } };
    expect(data.anexos.map((a) => [a.nome, a.ok])).toEqual([
      ["planilha.xlsx", false],
      ["quebrado.pdf", false],
      ["ok.txt", true],
    ]);
  });

  it("texto longo é cortado, e a resposta diz que cortou", async () => {
    const res = await chamar([txt("grande.txt", "a".repeat(TETO_POR_ANEXO + 10))]);
    const { data } = (await res.json()) as { data: { anexos: Array<{ texto: string; chars: number; truncado: boolean }> } };
    expect(data.anexos[0]).toMatchObject({ chars: TETO_POR_ANEXO + 10, truncado: true });
    expect(data.anexos[0]!.texto).toHaveLength(TETO_POR_ANEXO);
  });

  it("mais de 5 arquivos é 422; nenhum arquivo também", async () => {
    const seis = Array.from({ length: 6 }, (_, i) => txt(`${i}.txt`, "texto"));
    expect((await chamar(seis)).status).toBe(422);
    expect((await chamar([])).status).toBe(422);
  });
});
