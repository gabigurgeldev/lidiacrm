import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  segredo: "segredo-de-teste",
  contas: [] as Array<{ organization_id: string; nome: string; papel: string }>,
  auditorias: [] as unknown[],
}));

vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_t, k) => (k === "SUPORTE_V1_SECRET" ? estado.segredo : undefined) }),
}));
vi.mock("@/lib/audit", () => ({ audit: async (e: unknown) => void estado.auditorias.push(e) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (nome: string) =>
      nome === "fn_suporte_contas_por_email" ? { data: estado.contas, error: null } : { data: null, error: null },
  }),
}));

import { cabecalhosAssinados } from "./contrato";
import { rotaDeSuporte } from "./rota";

const ORG = "11111111-2222-4333-8444-555555555555";
const OUTRA = "99999999-2222-4333-8444-555555555555";

function pedido(url: string, opts: { metodo?: string; corpo?: string; email?: string; segredo?: string } = {}): Request {
  const metodo = opts.metodo ?? "GET";
  const h = cabecalhosAssinados({
    segredo: opts.segredo ?? "segredo-de-teste",
    metodo,
    url,
    corpo: opts.corpo ?? null,
    requestId: "r1",
    emailVerificado: opts.email ?? null,
  });
  return new Request(url, { method: metodo, headers: h, body: opts.corpo });
}

const ok = async () => ({ status: 200, body: { ok: true } });

describe("rotaDeSuporte", () => {
  beforeEach(() => {
    estado.segredo = "segredo-de-teste";
    estado.contas = [{ organization_id: ORG, nome: "Loja", papel: "admin" }];
    estado.auditorias = [];
  });

  it("sem segredo configurado: 503 — instalação de cliente não expõe nada", async () => {
    estado.segredo = "";
    const r = await rotaDeSuporte(pedido("https://crm.x/suporte/v1/saude"), { auditoria: "suporte.leitura", recurso: "x" }, ok);
    expect(r.status).toBe(503);
  });

  it("assinatura com outro segredo: 401", async () => {
    const r = await rotaDeSuporte(
      pedido("https://crm.x/suporte/v1/saude", { segredo: "outro" }),
      { auditoria: "suporte.leitura", recurso: "x" },
      ok,
    );
    expect(r.status).toBe(401);
  });

  it("assinatura de um caminho não vale para outro (conta B)", async () => {
    const assinado = pedido(`https://crm.x/suporte/v1/contas/${ORG}/diagnostico`, { email: "dono@loja.com" });
    const desviado = new Request(`https://crm.x/suporte/v1/contas/${OUTRA}/diagnostico`, { headers: assinado.headers });
    const r = await rotaDeSuporte(desviado, { orgDoCaminho: OUTRA, auditoria: "suporte.leitura", recurso: "x" }, ok);
    expect(r.status).toBe(401);
  });

  it("e-mail que não administra a conta: 403, e o handler nem roda", async () => {
    const handler = vi.fn(ok);
    const r = await rotaDeSuporte(
      pedido(`https://crm.x/suporte/v1/contas/${OUTRA}/diagnostico`, { email: "dono@loja.com" }),
      { orgDoCaminho: OUTRA, auditoria: "suporte.leitura", recurso: "x" },
      handler,
    );
    expect(r.status).toBe(403);
    expect(((await r.json()) as { erro: { codigo: string } }).erro.codigo).toBe("email_nao_pertence_a_conta");
    expect(handler).not.toHaveBeenCalled();
  });

  it("sem e-mail verificado em /contas: 403", async () => {
    const r = await rotaDeSuporte(
      pedido(`https://crm.x/suporte/v1/contas/${ORG}/diagnostico`),
      { orgDoCaminho: ORG, auditoria: "suporte.leitura", recurso: "x" },
      ok,
    );
    expect(r.status).toBe(403);
  });

  it("dono da conta: o handler recebe a organização do caminho, e a chamada é auditada nela", async () => {
    let recebida: string | null = null;
    const r = await rotaDeSuporte(
      pedido(`https://crm.x/suporte/v1/contas/${ORG}/diagnostico`, { email: "Dono@Loja.com" }),
      { orgDoCaminho: ORG, auditoria: "suporte.leitura", recurso: "x" },
      async ({ conta }) => {
        recebida = conta?.organizationId ?? null;
        return { status: 200, body: { ok: true } };
      },
    );
    expect(r.status).toBe(200);
    expect(recebida).toBe(ORG);
    expect(estado.auditorias).toHaveLength(1);
    expect(JSON.stringify(estado.auditorias[0])).not.toContain("dono@loja.com");
  });
});
