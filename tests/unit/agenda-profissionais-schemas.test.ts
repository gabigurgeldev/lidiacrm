import { describe, expect, it } from "vitest";

import { marcarSchema } from "@/app/api/v1/agenda/agendamentos/_schemas";
import {
  alterarProfissionalSchema,
  criarFolgaSchema,
  criarProfissionalSchema,
  removerFolgaSchema,
} from "@/app/api/v1/agenda/profissionais/_schemas";

/**
 * AS FORMAS DAS ROTAS DE PROFISSIONAIS E FOLGAS (migration 0245).
 *
 * Os limites espelham os CHECKs do banco; o que este arquivo prende é que a
 * recusa sai como 422 legível ANTES de virar 500 de constraint — e as duas
 * regras que não são de banco: profissional vinculada não se desvincula, e
 * folga de meio-dia pede início E fim.
 *
 *     npx vitest run tests/unit/agenda-profissionais-schemas.test.ts
 */

const UUID = "a1a1a1a1-0000-4000-8000-0000000000a1";
const OUTRO = "b2b2b2b2-0000-4000-8000-0000000000b2";

describe("criar profissional", () => {
  it("o mínimo é o nome — sem login é o caso comum", () => {
    expect(criarProfissionalSchema.safeParse({ nome: "Ana" }).success).toBe(true);
  });

  it("nome vazio, trilha fora de 1..8 e tipo que não é uuid são recusados", () => {
    expect(criarProfissionalSchema.safeParse({ nome: "   " }).success).toBe(false);
    expect(criarProfissionalSchema.safeParse({ nome: "Ana", trilha: 9 }).success).toBe(false);
    expect(criarProfissionalSchema.safeParse({ nome: "Ana", trilha: 0 }).success).toBe(false);
    expect(criarProfissionalSchema.safeParse({ nome: "Ana", tipos: ["consulta"] }).success).toBe(false);
  });

  it("jornada usa o MESMO shape de attendant_availability, e o fuso é conferido", () => {
    const ok = criarProfissionalSchema.safeParse({
      nome: "Ana",
      jornada: { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
    });
    expect(ok.success).toBe(true);
    const fusoInventado = criarProfissionalSchema.safeParse({
      nome: "Ana",
      jornada: { timezone: "America/Asunción", windows: [] },
    });
    expect(fusoInventado.success, "fuso que o Intl não conhece derrubaria a consulta de horários").toBe(false);
  });
});

describe("alterar profissional", () => {
  it("vincular a um membro é aceito", () => {
    expect(alterarProfissionalSchema.safeParse({ user_id: UUID }).success).toBe(true);
  });

  it("DESVINCULAR (user_id: null) é recusado — o update.sh recriaria a profissional do membro", () => {
    const r = alterarProfissionalSchema.safeParse({ user_id: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["user_id"]);
  });

  it("corpo vazio é recusado — 'alterei' sobre nada", () => {
    expect(alterarProfissionalSchema.safeParse({}).success).toBe(false);
  });

  it("desativar e limpar a trilha são alterações válidas", () => {
    expect(alterarProfissionalSchema.safeParse({ ativo: false }).success).toBe(true);
    expect(alterarProfissionalSchema.safeParse({ trilha: null }).success).toBe(true);
    expect(alterarProfissionalSchema.safeParse({ jornada: null }).success).toBe(true);
  });
});

describe("folgas", () => {
  it("o dia inteiro: só a data", () => {
    const r = criarFolgaSchema.safeParse({ data: "2026-09-07" });
    expect(r.success).toBe(true);
    expect(r.data?.indisponivel, "folga sem dizer o sentido tem de FECHAR horário, não abrir").toBe(true);
  });

  it("meio período pede início e fim juntos, e fim depois do início", () => {
    expect(criarFolgaSchema.safeParse({ data: "2026-09-07", inicio_minuto: 480 }).success).toBe(false);
    expect(criarFolgaSchema.safeParse({ data: "2026-09-07", inicio_minuto: 720, fim_minuto: 600 }).success).toBe(
      false,
    );
    expect(criarFolgaSchema.safeParse({ data: "2026-09-07", inicio_minuto: 480, fim_minuto: 720 }).success).toBe(true);
  });

  it("minuto fora de 0..1440 e data inexistente são recusados", () => {
    expect(criarFolgaSchema.safeParse({ data: "2026-09-07", inicio_minuto: 0, fim_minuto: 1441 }).success).toBe(false);
    expect(criarFolgaSchema.safeParse({ data: "2026-02-30" }).success).toBe(false);
    expect(criarFolgaSchema.safeParse({ data: "07/09/2026" }).success).toBe(false);
  });

  it("remover pede o id", () => {
    expect(removerFolgaSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(removerFolgaSchema.safeParse({}).success).toBe(false);
  });
});

describe("marcar (corpo do POST)", () => {
  const base = { event_type_id: UUID, starts_at: "2026-09-02T10:00:00-03:00" };

  it("aceita 1 ou 2 profissionais e a conversa", () => {
    expect(marcarSchema.safeParse({ ...base, professional_ids: [UUID] }).success).toBe(true);
    expect(marcarSchema.safeParse({ ...base, professional_ids: [UUID, OUTRO], conversation_id: OUTRO }).success).toBe(
      true,
    );
  });

  it("recusa lista vazia e três profissionais", () => {
    expect(marcarSchema.safeParse({ ...base, professional_ids: [] }).success).toBe(false);
    expect(marcarSchema.safeParse({ ...base, professional_ids: [UUID, OUTRO, UUID] }).success).toBe(false);
  });
});
