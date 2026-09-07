/**
 * A CRIAÇÃO DE UM DISPARO — uma regra só, dois chamadores.
 *
 * ## O defeito que este arquivo previne
 *
 * A sequência inteira (achar a conexão, conferir se ela permite o modo,
 * pré-voar o modelo, montar o recorte, gravar disparo e linhas) vivia dentro do
 * `POST /api/v1/bulk-sends`. Com o bloco de fluxo `whatsapp.bulk_send`, ela
 * passou a ter DOIS chamadores — e reescrevê-la no bloco produziria duas
 * versões da regra que decide QUEM recebe uma campanha.
 *
 * A pergunta que este arquivo responde é a que importa depois da extração: a
 * linha gravada é a mesma, venha de quem vier? A única diferença legítima é a
 * autoria — pessoa grava `created_by_user_id`, fluxo grava
 * `created_by_flow_execution_id` (migration 0209). Qualquer outra divergência é
 * a extração tendo vazado.
 */
import { describe, expect, it, vi } from "vitest";

import { criarDisparo } from "@/lib/bulk-send/criar-disparo";
import type { CriarDisparoInput } from "@/lib/schemas/bulk-sends";

vi.mock("@/lib/bulk-send/montagem", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    // O recorte tem lógica própria (dedupe por variante de telefone, guardas de
    // opt-out) e teste próprio. Aqui ele é entrada, não sujeito.
    montarRecortePorTags: vi.fn(async () => ({
      linhas: [{ contact_id: "c1", status: "pending", skip_reason: null }],
      vaoReceber: 1,
      foraPorMotivo: {},
      repetidos: 0,
      naoEncontrados: 0,
    })),
    montarRecortePorIds: vi.fn(async () => ({
      linhas: [{ contact_id: "c1", status: "pending", skip_reason: null }],
      vaoReceber: 1,
      foraPorMotivo: {},
      repetidos: 0,
      naoEncontrados: 0,
    })),
  };
});

const ENTRADA: CriarDisparoInput = {
  name: "Campanha",
  channel_session_id: "11111111-2222-4333-8444-555555555555",
  mode: "freeform",
  body: "Oi",
  template_values: {},
  interval_ms: 5000,
  audiencia: { kind: "tags", tags: ["clientes"] },
} as CriarDisparoInput;

/**
 * Um Supabase falso que guarda o que foi inserido.
 *
 * Falso e não mock de biblioteca: o que interessa medir é a LINHA gravada, e um
 * espião por método esconderia isso atrás de asserções de chamada.
 */
function supabaseFalso(sessao: Record<string, unknown> | null = { id: "s1", provider: "waha", status: "WORKING" }) {
  const inseridos: { bulk_sends: unknown[]; bulk_send_recipients: unknown[] } = {
    bulk_sends: [],
    bulk_send_recipients: [],
  };

  const api = {
    from(tabela: string) {
      return {
        select: () => api.from(tabela),
        eq: () => api.from(tabela),
        is: () => api.from(tabela),
        maybeSingle: async () => ({ data: sessao, error: null }),
        insert(linhas: unknown) {
          const arr = Array.isArray(linhas) ? linhas : [linhas];
          if (tabela === "bulk_sends") inseridos.bulk_sends.push(...arr);
          if (tabela === "bulk_send_recipients") inseridos.bulk_send_recipients.push(...arr);
          return {
            select: () => ({
              single: async () => ({ data: { id: "disparo-novo" }, error: null }),
            }),
            // `bulk_send_recipients` não faz `.select()` depois do insert.
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
        },
        delete: () => api.from(tabela),
      };
    },
    inseridos,
  };
  return api as unknown as Parameters<typeof criarDisparo>[0] & { inseridos: typeof inseridos };
}

describe("criar disparo, venha de quem vier", () => {
  it("criado por PESSOA grava o usuário e nenhum fluxo", async () => {
    const db = supabaseFalso();
    const r = await criarDisparo(
      db,
      { organizationId: "org-1", autor: { tipo: "pessoa", userId: "user-7" } },
      ENTRADA,
    );

    expect(r.ok).toBe(true);
    const linha = db.inseridos.bulk_sends[0] as Record<string, unknown>;
    expect(linha.created_by_user_id).toBe("user-7");
    expect(linha.created_by_flow_execution_id).toBeNull();
  });

  it("⭐ criado por FLUXO grava a execução, e não fica órfã", async () => {
    // Sem esta coluna a campanha aparece na tela sem dono e sem origem, e
    // ninguém sabe qual fluxo desligar quando ela estiver mandando o que não
    // devia (migration 0209).
    const db = supabaseFalso();
    await criarDisparo(
      db,
      { organizationId: "org-1", autor: { tipo: "fluxo", flowExecutionId: "exec-42" } },
      ENTRADA,
    );

    const linha = db.inseridos.bulk_sends[0] as Record<string, unknown>;
    expect(linha.created_by_flow_execution_id).toBe("exec-42");
    expect(linha.created_by_user_id).toBeNull();
  });

  it("⭐ tudo o mais na linha é IDÊNTICO nos dois caminhos", async () => {
    const dbPessoa = supabaseFalso();
    const dbFluxo = supabaseFalso();
    await criarDisparo(
      dbPessoa,
      { organizationId: "org-1", autor: { tipo: "pessoa", userId: "user-7" } },
      ENTRADA,
    );
    await criarDisparo(
      dbFluxo,
      { organizationId: "org-1", autor: { tipo: "fluxo", flowExecutionId: "exec-42" } },
      ENTRADA,
    );

    const semAutoria = (l: Record<string, unknown>) => {
      const { created_by_user_id, created_by_flow_execution_id, ...resto } = l;
      void created_by_user_id;
      void created_by_flow_execution_id;
      return resto;
    };

    expect(
      semAutoria(dbFluxo.inseridos.bulk_sends[0] as Record<string, unknown>),
      "a extração vazou: os dois chamadores gravam campanhas diferentes",
    ).toEqual(semAutoria(dbPessoa.inseridos.bulk_sends[0] as Record<string, unknown>));
  });

  it("nasce sempre em RASCUNHO — quem dispara é um segundo gesto", async () => {
    const db = supabaseFalso();
    await criarDisparo(
      db,
      { organizationId: "org-1", autor: { tipo: "pessoa", userId: "u" } },
      ENTRADA,
    );
    expect((db.inseridos.bulk_sends[0] as Record<string, unknown>).status).toBe("draft");
  });

  it("conexão de outra organização é recusada por código, não por exceção", async () => {
    const db = supabaseFalso(null);
    const r = await criarDisparo(
      db,
      { organizationId: "org-1", autor: { tipo: "pessoa", userId: "u" } },
      ENTRADA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusa.codigo).toBe("conexao_nao_encontrada");
  });

  it("conexão arquivada é recusa própria, distinta de não existir", async () => {
    // Distinguir importa: "não encontrada" manda procurar erro de digitação,
    // "arquivada" manda escolher outra conexão.
    const db = supabaseFalso({
      id: "s1",
      provider: "waha",
      status: "WORKING",
      archived_at: "2026-01-01T00:00:00Z",
    });
    const r = await criarDisparo(
      db,
      { organizationId: "org-1", autor: { tipo: "pessoa", userId: "u" } },
      ENTRADA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusa.codigo).toBe("conexao_arquivada");
  });
});
