/**
 * "COMEÇAR SOZINHO" PRECISA GRAVAR O ESTADO QUE O WORKER RECLAMA.
 *
 * ## O defeito que este arquivo fecha, e que ele já pegou uma vez
 *
 * A primeira versão do adapter gravava `status: "scheduled"` com
 * `scheduled_for` agora. Parece certo e não é: `fn_claim_due_bulk_sends`
 * (migration 0204) reclama
 *
 *     status = 'running' and next_send_at <= now()
 *
 * e `scheduled` é promovido por outro caminho, feito para agendamento FUTURO.
 * O efeito: a campanha nasce, aparece na tela como se fosse disparar, e não sai
 * nunca. Ninguém vê erro — o fluxo terminou "com sucesso", a campanha existe, e
 * a falha só aparece do lado do cliente que não recebeu.
 *
 * O teste espelha a condição do claim em vez de repetir a string "running":
 * assim ele continua valendo se o estado mudar de nome, e reprova se alguém
 * gravar de novo um estado que o claim não enxerga.
 */
import { describe, expect, it, vi } from "vitest";

import { criarPortas } from "@/lib/flow-engine/supabase-adapter";

vi.mock("@/lib/bulk-send/criar-disparo", () => ({
  criarDisparo: vi.fn(async () => ({
    ok: true,
    disparoId: "disparo-1",
    recorte: { vaoReceber: 7, linhas: [], foraPorMotivo: {}, repetidos: 0, naoEncontrados: 0 },
    provider: "waha",
  })),
}));

/** O que `fn_claim_due_bulk_sends` exige para uma campanha ser reclamada. */
function oClaimEnxerga(linha: Record<string, unknown>): boolean {
  if (linha.status !== "running") return false;
  const quando = linha.next_send_at;
  if (typeof quando !== "string") return false;
  return new Date(quando).getTime() <= Date.now() + 1000;
}

function adminFalso() {
  const updates: Record<string, unknown>[] = [];
  const api = {
    from() {
      return {
        select: () => api.from(),
        eq: () => api.from(),
        is: () => api.from(),
        maybeSingle: async () => ({ data: null, error: null }),
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        },
      };
    },
    updates,
  };
  return api;
}

const EXEC = {
  id: "exec-1",
  flow_id: "fluxo-1",
  organization_id: "org-1",
};

function portasDe(admin: ReturnType<typeof adminFalso>) {
  return criarPortas(
    admin as unknown as Parameters<typeof criarPortas>[0],
    EXEC as unknown as Parameters<typeof criarPortas>[1],
  );
}

const PEDIDO = {
  nome: "Campanha",
  canalId: "11111111-2222-4333-8444-555555555555",
  modo: "freeform" as const,
  texto: "Oi",
  modeloValores: {},
  audiencia: { tipo: "tags" as const, tags: ["clientes"] },
  intervaloMs: 5000,
  comecarSozinho: true,
};

describe("o disparo que o fluxo começa sozinho", () => {
  it("⭐ grava um estado que o claim do worker ENXERGA", async () => {
    const admin = adminFalso();
    const portas = portasDe(admin);

    const desfecho = (await portas.disparo.criar(PEDIDO)) as { kind: string; comecou: boolean };

    expect(desfecho.kind).toBe("criado");
    expect(desfecho.comecou, "disse que começou e não começou").toBe(true);
    expect(admin.updates, "não gravou estado nenhum — a campanha fica parada").toHaveLength(1);
    expect(
      oClaimEnxerga(admin.updates[0]!),
      `estado gravado não é reclamado por fn_claim_due_bulk_sends: ${JSON.stringify(admin.updates[0])}`,
    ).toBe(true);
  });

  it("sem 'começar sozinho', não mexe no estado — a campanha fica em rascunho", async () => {
    const admin = adminFalso();
    const portas = portasDe(admin);

    const desfecho = (await portas.disparo.criar({
      ...PEDIDO,
      comecarSozinho: false,
    })) as { comecou: boolean };

    expect(desfecho.comecou).toBe(false);
    expect(admin.updates).toHaveLength(0);
  });
});
