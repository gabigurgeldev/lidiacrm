import { describe, expect, it, vi } from "vitest";

import { adiamentoPorFluxoConduzindo, coordenadorAtivoNoCanal, entregarAoFluxoPelaEquipe } from "./via-supabase";

/**
 * O lado Supabase do coordenador (rotas do app, motor de fluxos). A RPC é a
 * mesma do worker e está provada em tests/invariants/coordenador-*.test.ts;
 * aqui se prova o que este transporte acrescenta: a precedência da política e
 * a nova tentativa em conflito.
 */

function adminFalso(tabelas: Record<string, unknown>, rpc?: (args: Record<string, unknown>) => unknown) {
  const rpcSpy = vi.fn(async (_nome: string, args: Record<string, unknown>) => ({ data: rpc?.(args) ?? null, error: null }));
  const cliente = {
    from(tabela: string) {
      const linha = tabelas[tabela];
      const cadeia: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: linha, error: null }).then(r),
      };
      for (const m of ["select", "eq"]) cadeia[m] = () => cadeia;
      cadeia.maybeSingle = () => Promise.resolve({ data: linha, error: null });
      return cadeia;
    },
    rpc: rpcSpy,
  };
  return { admin: cliente as never, rpcSpy };
}

describe("coordenadorAtivoNoCanal", () => {
  it("o ponteiro do NÚMERO vence o da organização", async () => {
    // A versão lida é a do ponteiro escolhido; o falso devolve `active` para
    // qualquer id, então o que se prova é que existe ponteiro aplicável.
    const { admin } = adminFalso({
      coord_politica_ponteiros: [
        { channel_session_id: null, versao_id: "org" },
        { channel_session_id: "canal-1", versao_id: "canal" },
      ],
      coord_politica_versoes: { modo: "active" },
    });
    expect(await coordenadorAtivoNoCanal(admin, "org-1", "canal-1")).toBe(true);
  });

  it("sem ponteiro nenhum: não ativo (o comportamento de antes do coordenador)", async () => {
    const { admin } = adminFalso({ coord_politica_ponteiros: [] });
    expect(await coordenadorAtivoNoCanal(admin, "org-1", "canal-1")).toBe(false);
  });

  it("shadow não é ativo", async () => {
    const { admin } = adminFalso({
      coord_politica_ponteiros: [{ channel_session_id: null, versao_id: "v" }],
      coord_politica_versoes: { modo: "shadow" },
    });
    expect(await coordenadorAtivoNoCanal(admin, "org-1", null)).toBe(false);
  });
});

describe("entregarAoFluxoPelaEquipe", () => {
  it("transiciona como ação MANUAL — a única categoria que tira a conversa de uma pessoa", async () => {
    const { admin, rpcSpy } = adminFalso({ coord_estado_conversa: { versao: 3 } }, () => ({ ok: true, geracao: 5 }));
    const r = await entregarAoFluxoPelaEquipe(admin, {
      organizationId: "org-1",
      conversationId: "conv-1",
      executionId: "exec-1",
      userId: "user-1",
    });
    expect(r).toEqual({ ok: true, geracao: 5 });
    expect(rpcSpy).toHaveBeenCalledWith(
      "fn_coord_transicionar",
      expect.objectContaining({
        p_versao_esperada: 3,
        p_dono_tipo: "fluxo",
        p_dono_execution_id: "exec-1",
        p_categoria: "manual",
        p_motivo: "ativacao_manual",
      }),
    );
  });

  it("conflito: relê a versão e tenta UMA vez mais; persistindo, desiste com o motivo", async () => {
    const { admin, rpcSpy } = adminFalso({ coord_estado_conversa: { versao: 1 } }, () => ({
      ok: false,
      motivo: "conflito",
    }));
    const r = await entregarAoFluxoPelaEquipe(admin, {
      organizationId: "org-1",
      conversationId: "conv-1",
      executionId: "exec-1",
      userId: "user-1",
    });
    expect(r).toEqual({ ok: false, motivo: "conflito" });
    expect(rpcSpy).toHaveBeenCalledTimes(2);
  });
});

describe("adiamentoPorFluxoConduzindo — automação que fala com o cliente", () => {
  const ativo = {
    coord_politica_ponteiros: [{ channel_session_id: null, versao_id: "v" }],
    coord_politica_versoes: { modo: "active" },
    conversations: { id: "conv-1" },
  };
  const agora = new Date("2026-10-09T12:00:00.000Z");
  const q = { organizationId: "org-1", contactId: "ct-1", channelSessionId: "canal-1", agora };

  it("fluxo vivo no meio da etapa: adia 15 minutos", async () => {
    const { admin } = adminFalso({
      ...ativo,
      coord_estado_conversa: { dono_tipo: "fluxo", dono_execution_id: "exec-1" },
      flow_executions: { status: "waiting" },
    });
    expect(await adiamentoPorFluxoConduzindo(admin, q)).toBe("2026-10-09T12:15:00.000Z");
  });

  it("fluxo que já terminou não segura a automação", async () => {
    const { admin } = adminFalso({
      ...ativo,
      coord_estado_conversa: { dono_tipo: "fluxo", dono_execution_id: "exec-1" },
      flow_executions: { status: "completed" },
    });
    expect(await adiamentoPorFluxoConduzindo(admin, q)).toBeNull();
  });

  it("agente dono não adia — a automação já falava por cima dele antes do coordenador", async () => {
    const { admin } = adminFalso({ ...ativo, coord_estado_conversa: { dono_tipo: "agente", dono_execution_id: null } });
    expect(await adiamentoPorFluxoConduzindo(admin, q)).toBeNull();
  });

  it("sem coordenador ativo: nada muda", async () => {
    const { admin } = adminFalso({ coord_politica_ponteiros: [] });
    expect(await adiamentoPorFluxoConduzindo(admin, q)).toBeNull();
  });
});
