import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { listaAgendamentos } from "@/lib/agenda/consulta";
import { escopoDaAgenda } from "@/lib/agenda/escopo";

/**
 * AGENDA: CADA ATENDENTE VÊ A SUA (migration 0249) — o lado do app.
 *
 * A regra que VALE é a RLS, medida em `tests/invariants/agenda-cada-um-ve-a-sua`.
 * Aqui se prende o que o app diz sobre ela:
 *
 *  1. o escopo: atendente e viewer = "proprio"; gerente, admin e platform admin
 *     = "organizacao" — a mesma fronteira de `fn_can_view_appointment`;
 *  2. a listagem recortada repete o filtro do banco (dono OU quem criou OU
 *     participante), para valer também se a policy for afrouxada;
 *  3. a coleta de horários livres NÃO é feita com a sessão — senão o horário do
 *     colega, que o atendente não lê, apareceria livre.
 *
 *     npx vitest run tests/unit/agenda-cada-um-ve-a-sua.test.ts
 */

describe("o escopo de quem olha", () => {
  it.each([
    ["viewer", false, "proprio"],
    ["agent", false, "proprio"],
    ["ai_operator", false, "proprio"],
    ["manager", false, "organizacao"],
    ["admin", false, "organizacao"],
    ["viewer", true, "organizacao"],
    [null, true, "organizacao"],
    [null, false, "proprio"],
  ] as const)("papel %s, platform admin %s → %s", (papel, plataforma, esperado) => {
    expect(escopoDaAgenda(papel, plataforma)).toBe(esperado);
  });
});

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const EU = "bbbbbbbb-0000-4000-8000-00000000000b";
const MINHA_PROF = "cccccccc-0000-4000-8000-00000000000c";
const ONDE_SOU_APOIO = "dddddddd-0000-4000-8000-00000000000d";

/** Dublê que registra a cadeia de filtros de cada tabela. */
function dubleDoBanco() {
  const chamadas: Record<string, Array<{ metodo: string; args: unknown[] }>> = {};
  const respostas: Record<string, unknown[]> = {
    calendar_professionals: [{ id: MINHA_PROF }],
    calendar_appointment_professionals: [{ appointment_id: ONDE_SOU_APOIO }],
    calendar_appointments: [],
  };
  const cliente = {
    from(tabela: string) {
      const registro = (chamadas[tabela] ??= []);
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "or", "order", "limit", "gte", "lt", "gt"]) {
        cadeia[metodo] = (...args: unknown[]) => {
          registro.push({ metodo, args });
          return cadeia;
        };
      }
      cadeia.then = (r: (v: unknown) => unknown) => r({ data: respostas[tabela] ?? [], error: null });
      return cadeia;
    },
  } as unknown as SupabaseClient;
  return { cliente, chamadas };
}

describe("a listagem recortada", () => {
  const recorte = { de: "2026-11-01T03:00:00.000Z", ate: "2026-11-08T03:00:00.000Z", limite: 200 };

  it("restrita: filtra dono, quem criou e onde participo — e a janela recorta a participação", async () => {
    const { cliente, chamadas } = dubleDoBanco();
    const r = await listaAgendamentos(cliente, ORG, { ...recorte, restritoA: { userId: EU } });
    expect(r.ok).toBe(true);

    const filtro = chamadas.calendar_appointments?.find((c) => c.metodo === "or")?.args[0];
    expect(filtro).toBe(`owner_user_id.eq.${EU},created_by_user_id.eq.${EU},id.in.(${ONDE_SOU_APOIO})`);

    const participacao = chamadas.calendar_appointment_professionals ?? [];
    expect(participacao.some((c) => c.metodo === "in" && (c.args[1] as string[]).includes(MINHA_PROF))).toBe(true);
    expect(participacao.some((c) => c.metodo === "lt" && c.args[1] === recorte.ate)).toBe(true);
    // A org vai explícita em TODA consulta — o filtro é a defesa que sobra.
    for (const tabela of ["calendar_professionals", "calendar_appointment_professionals", "calendar_appointments"]) {
      expect(
        (chamadas[tabela] ?? []).some((c) => c.metodo === "eq" && c.args[0] === "organization_id" && c.args[1] === ORG),
        `${tabela} sem organization_id`,
      ).toBe(true);
    }
  });

  it("CONTROLE: sem restrição (gerente), nenhum filtro de pessoa", async () => {
    const { cliente, chamadas } = dubleDoBanco();
    await listaAgendamentos(cliente, ORG, recorte);
    expect((chamadas.calendar_appointments ?? []).some((c) => c.metodo === "or")).toBe(false);
    expect(chamadas.calendar_professionals).toBeUndefined();
  });

  it("quem não é profissional de ninguém: só dono e quem criou", async () => {
    const { cliente, chamadas } = dubleDoBanco();
    const semProf = {
      ...cliente,
      from(tabela: string) {
        const c = (cliente as unknown as { from: (t: string) => Record<string, unknown> }).from(tabela);
        if (tabela === "calendar_professionals") {
          c.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
        }
        return c;
      },
    } as unknown as SupabaseClient;
    await listaAgendamentos(semProf, ORG, { ...recorte, restritoA: { userId: EU } });
    const filtro = chamadas.calendar_appointments?.find((c) => c.metodo === "or")?.args[0];
    expect(filtro).toBe(`owner_user_id.eq.${EU},created_by_user_id.eq.${EU}`);
  });
});

describe("as rotas dizem o mesmo que o banco", () => {
  const fonte = (p: string) => readFileSync(p, "utf8");

  it("a listagem recorta abaixo de gerente e devolve o escopo", () => {
    const rota = fonte("app/api/v1/agenda/agendamentos/route.ts");
    expect(rota).toMatch(/escopoDaAgenda\(activeOrg\.role, user\.is_platform_admin\)/);
    expect(rota).toMatch(/restritoA: escopo === "proprio" \? \{ userId: user\.id \} : null/);
    expect(rota).toMatch(/meta: \{ escopo \}/);
  });

  it("a coleta de horários livres é do admin — na rota de horários e na escrita", () => {
    expect(fonte("app/api/v1/agenda/horarios-livres/route.ts")).toMatch(
      /horariosLivresDaOrg\(supabase,[\s\S]*?const supabase = createAdminClient\(\)|const supabase = createAdminClient\(\);[\s\S]*?horariosLivresDaOrg\(supabase/,
    );
    expect(fonte("app/api/v1/agenda/agendamentos/route.ts")).toMatch(/leitorDaOcupacao: createAdminClient\(\)/);
  });

  it("a página da Agenda resolve o escopo pela mesma função", () => {
    expect(fonte("app/app/agenda/page.tsx")).toMatch(/escopoDaAgenda\(activeOrg\.role, user\.is_platform_admin\)/);
  });
});
