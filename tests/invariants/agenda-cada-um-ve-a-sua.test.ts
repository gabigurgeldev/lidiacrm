import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * AGENDA: CADA ATENDENTE VÊ A SUA (migration 0249) — medido pela porta do
 * usuário, não pelo texto da policy.
 *
 * Atendente (agent) e viewer veem só o agendamento em que são DONOS, em que
 * PARTICIPAM (apoio com login) ou que CRIARAM; gerente e admin veem a
 * organização inteira. Cada caso vem em PAR — o que não pode ver não vê E o
 * que pode ver vê —, porque a metade negativa sozinha fica verde com uma
 * policy que nega todo mundo.
 *
 * `set role authenticated` + JWT é como o PostgREST fala com o banco, e o
 * PostgREST é exposto ao browser por construção: `requireRole()` na rota Next
 * não é a única porta.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

function ultimaLinha(saida: string): string {
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  const ultima = linhas[linhas.length - 1];
  if (ultima === undefined) throw new Error(`o comando não devolveu nada: ${saida}`);
  return ultima;
}

function comoUsuario(userId: string, comando: string): string {
  return `
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${comando}
  `;
}

/** SQLSTATE do erro, ou `null` se passou. */
function erroDe(script: string): string | null {
  try {
    sql(`\\set VERBOSITY verbose\n${script}`);
    return null;
  } catch (e) {
    const saida = String((e as { stderr?: unknown }).stderr ?? e);
    const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(saida);
    if (!m) throw new Error(`falhou sem SQLSTATE legível: ${saida}`);
    return m[1] as string;
  }
}

const ORG = "ce1a0249-0000-4000-8000-00000000000a";
const ORG_OUTRA = "ce1a0249-0000-4000-8000-00000000000b";
const ADMIN = "ce1a0249-1111-4000-8000-000000000001";
const MANAGER = "ce1a0249-1111-4000-8000-000000000002";
const AG_A = "ce1a0249-1111-4000-8000-000000000003";
const AG_B = "ce1a0249-1111-4000-8000-000000000004";
const VIEWER = "ce1a0249-1111-4000-8000-000000000005";
const TIPO_UM = "ce1a0249-3333-4000-8000-000000000001";
const TIPO_DOIS = "ce1a0249-3333-4000-8000-000000000002";
const CON_A = "ce1a0249-4444-4000-8000-000000000001";
const CON_B = "ce1a0249-4444-4000-8000-000000000002";

/** A profissional do membro — criada se o trigger de adoção não a criou. */
function profissionalDe(userId: string, nome: string): string {
  sql(`
    insert into public.calendar_professionals (organization_id, user_id, name)
    select '${ORG}', '${userId}', '${nome}'
     where not exists (select 1 from public.calendar_professionals
                        where organization_id = '${ORG}' and user_id = '${userId}');
  `);
  return ultimaLinha(
    sql(`select id from public.calendar_professionals where organization_id = '${ORG}' and user_id = '${userId}';`),
  );
}

function marcar(titulo: string, inicio: string, fim: string, tipo: string, profissionais: string[]): string {
  const compromisso = JSON.stringify({ event_type_id: tipo, title: titulo, starts_at: inicio, ends_at: fim });
  const lista = profissionais.map((p) => `'${p}'`).join(", ");
  return `select public.fn_agenda_marcar('${ORG}', '${compromisso}'::jsonb, array[${lista}]::uuid[]);`;
}

/** Os títulos deste arquivo que a sessão enxerga, ordenados. */
function titulosQueVe(userId: string): string[] {
  const saida = sql(
    comoUsuario(
      userId,
      `select coalesce(string_agg(title, '|' order by title), '') from public.calendar_appointments
        where organization_id = '${ORG}' and title like 'inv0249 %';`,
    ),
  );
  const ultima = saida.split("\n").map((l) => l.trim()).pop() ?? "";
  return ultima ? ultima.split("|") : [];
}

/** Quantas linhas o UPDATE alcançou, como a sessão. */
function linhasAlteradas(userId: string, titulo: string): number {
  return Number(
    ultimaLinha(
      sql(
        comoUsuario(
          userId,
          `with u as (update public.calendar_appointments set notes = 'tocado'
                       where organization_id = '${ORG}' and title = '${titulo}' returning 1)
           select count(*) from u;`,
        ),
      ),
    ),
  );
}

let PROF_A = "";
let PROF_B = "";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}',   'inv0249-admin@invariant.test'),
      ('${MANAGER}', 'inv0249-manager@invariant.test'),
      ('${AG_A}',    'inv0249-ag-a@invariant.test'),
      ('${AG_B}',    'inv0249-ag-b@invariant.test'),
      ('${VIEWER}',  'inv0249-viewer@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'inv0249', 'Inv 0249', 'Inv 0249'),
      ('${ORG_OUTRA}', 'inv0249-outra', 'Inv 0249 outra', 'Inv 0249 outra')
      on conflict (id) do nothing;
  `);
  // O primeiro membro ativo entra sozinho (é ele que a 0245 adota como dono).
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at)
       values ('${ADMIN}', '${ORG}', 'admin', now()) on conflict do nothing;`);
  sql(`
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER}', '${ORG}', 'manager', now()),
      ('${AG_A}',    '${ORG}', 'agent',   now()),
      ('${AG_B}',    '${ORG}', 'agent',   now()),
      ('${VIEWER}',  '${ORG}', 'viewer',  now())
      on conflict do nothing;
    insert into public.calendar_event_types
      (id, organization_id, name, slug, category, duration_minutes, professionals_required, is_active)
    values
      ('${TIPO_UM}',   '${ORG}', 'Uma',   'inv0249-uma',   'consulta', 30, 1, true),
      ('${TIPO_DOIS}', '${ORG}', 'Duas',  'inv0249-duas',  'consulta', 30, 2, true)
      on conflict (id) do nothing;
    insert into public.calendar_connections (id, organization_id, user_id, account_email, status) values
      ('${CON_A}', '${ORG}', '${AG_A}', 'inv0249-a@invariant.test', 'healthy'),
      ('${CON_B}', '${ORG}', '${AG_B}', 'inv0249-b@invariant.test', 'healthy')
      on conflict (id) do nothing;
    insert into public.calendar_external_events
      (organization_id, connection_id, external_calendar_id, external_event_id, title, starts_at, ends_at) values
      ('${ORG}', '${CON_A}', 'primary', 'inv0249-ev-a', 'Dentista da A', '2028-03-01T13:00:00Z', '2028-03-01T14:00:00Z'),
      ('${ORG}', '${CON_B}', 'primary', 'inv0249-ev-b', 'Pessoal da B',  '2028-03-01T15:00:00Z', '2028-03-01T16:00:00Z')
      on conflict do nothing;
  `);
  PROF_A = profissionalDe(AG_A, "Atendente A");
  PROF_B = profissionalDe(AG_B, "Atendente B");
  profissionalDe(VIEWER, "Viewer");

  // Pela SESSÃO da A: o próprio, e um para a colega B (prova o RETURNING com a
  // autoria — sem "quem criou vê", esta linha morreria em violação de RLS).
  sql(comoUsuario(AG_A, marcar("inv0249 da A", "2028-03-02T13:00:00Z", "2028-03-02T13:30:00Z", TIPO_UM, [PROF_A])));
  sql(comoUsuario(AG_A, marcar("inv0249 A marcou para B", "2028-03-02T14:00:00Z", "2028-03-02T14:30:00Z", TIPO_UM, [PROF_B])));
  // Pelo service role (a IA, a sincronização): da B, e B principal com A de apoio.
  sql(marcar("inv0249 da B", "2028-03-02T15:00:00Z", "2028-03-02T15:30:00Z", TIPO_UM, [PROF_B]));
  sql(marcar("inv0249 B com A de apoio", "2028-03-02T16:00:00Z", "2028-03-02T16:30:00Z", TIPO_DOIS, [PROF_B, PROF_A]));
  // Legado por dono (anterior à 0245, sem participante): da B e do viewer.
  sql(`
    insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, owner_user_id, status) values
      ('${ORG}', 'inv0249 legado da B',   '2028-03-03T13:00:00Z', '2028-03-03T14:00:00Z', '${AG_B}',   'confirmed'),
      ('${ORG}', 'inv0249 legado do viewer', '2028-03-03T15:00:00Z', '2028-03-03T16:00:00Z', '${VIEWER}', 'confirmed'),
      ('${ORG}', 'inv0249 descartável',   '2028-03-04T13:00:00Z', '2028-03-04T14:00:00Z', '${AG_B}',   'confirmed');
  `);
});

describe("quem vê o quê", () => {
  it("a atendente A vê o que é dela, o que ela criou para a colega e onde é apoio — e nada mais", () => {
    expect(titulosQueVe(AG_A)).toEqual([
      "inv0249 A marcou para B",
      "inv0249 B com A de apoio",
      "inv0249 da A",
    ]);
  });

  it("a atendente B vê o que é dela (inclusive o que a A marcou para ela) — e não o da A", () => {
    expect(titulosQueVe(AG_B)).toEqual([
      "inv0249 A marcou para B",
      "inv0249 B com A de apoio",
      "inv0249 da B",
      "inv0249 descartável",
      "inv0249 legado da B",
    ]);
  });

  it("o viewer vê só o próprio", () => {
    expect(titulosQueVe(VIEWER)).toEqual(["inv0249 legado do viewer"]);
  });

  it.each([
    ["gerente", MANAGER],
    ["admin", ADMIN],
  ])("o %s vê a organização inteira", (_papel, quem) => {
    expect(titulosQueVe(quem)).toHaveLength(7);
  });
});

describe("quem mexe no quê", () => {
  it("a atendente A NÃO altera o agendamento da colega...", () => {
    expect(linhasAlteradas(AG_A, "inv0249 da B")).toBe(0);
  });

  it("...e altera o próprio e o que ela marcou para a colega", () => {
    expect(linhasAlteradas(AG_A, "inv0249 da A")).toBe(1);
    expect(linhasAlteradas(AG_A, "inv0249 A marcou para B")).toBe(1);
  });

  it("o viewer não altera nem o próprio — o gate de escrita continua agent+", () => {
    expect(linhasAlteradas(VIEWER, "inv0249 legado do viewer")).toBe(0);
  });

  it("o gerente altera o de qualquer um", () => {
    expect(linhasAlteradas(MANAGER, "inv0249 da B")).toBe(1);
  });

  it("a atendente NÃO grava agendamento cru em nome de outra autora", () => {
    expect(
      erroDe(
        comoUsuario(
          AG_A,
          `insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, created_by_user_id)
             values ('${ORG}', 'inv0249 forjado', '2028-03-05T13:00:00Z', '2028-03-05T14:00:00Z', '${AG_B}');`,
        ),
      ),
    ).toBe("42501");
  });

  it("apagar é da gerência: a atendente não apaga nem o dela; o gerente apaga", () => {
    const apagou = (quem: string, titulo: string) =>
      Number(
        ultimaLinha(
          sql(
            comoUsuario(
              quem,
              `with d as (delete from public.calendar_appointments
                           where organization_id = '${ORG}' and title = '${titulo}' returning 1)
               select count(*) from d;`,
            ),
          ),
        ),
      );
    expect(apagou(AG_B, "inv0249 descartável")).toBe(0);
    expect(apagou(MANAGER, "inv0249 descartável")).toBe(1);
  });
});

describe("o Google: o título do evento é da pessoa", () => {
  const eventosQueVe = (quem: string) =>
    ultimaLinha(
      sql(
        comoUsuario(
          quem,
          `select coalesce(string_agg(external_event_id, '|' order by external_event_id), '-')
             from public.calendar_external_events where organization_id = '${ORG}';`,
        ),
      ),
    );

  it("a atendente vê só os eventos da própria conexão", () => {
    expect(eventosQueVe(AG_A)).toBe("inv0249-ev-a");
  });

  it("...e o gerente vê os de todos", () => {
    expect(eventosQueVe(MANAGER)).toBe("inv0249-ev-a|inv0249-ev-b");
  });
});

describe("a reconferência sob trava enxerga o que a sessão não lê", () => {
  it("a atendente A, marcando para a B, esbarra no legado da B que ela não vê", () => {
    expect(
      erroDe(
        comoUsuario(
          AG_A,
          `select public.fn_agenda_conferir_livre('${ORG}', array['${PROF_B}']::uuid[],
                   '2028-03-03T13:30:00Z', '2028-03-03T14:30:00Z', null);`,
        ),
      ),
    ).toBe("23505");
  });

  it("CONTROLE: fora do legado, passa", () => {
    expect(
      erroDe(
        comoUsuario(
          AG_A,
          `select public.fn_agenda_conferir_livre('${ORG}', array['${PROF_B}']::uuid[],
                   '2028-03-03T18:00:00Z', '2028-03-03T18:30:00Z', null);`,
        ),
      ),
    ).toBeNull();
  });

  it("e recusa organização alheia — definer não é porta para outro tenant", () => {
    expect(
      erroDe(
        comoUsuario(
          AG_A,
          `select public.fn_agenda_conferir_livre('${ORG_OUTRA}', array['${PROF_B}']::uuid[],
                   '2028-03-03T13:30:00Z', '2028-03-03T14:30:00Z', null);`,
        ),
      ),
    ).toBe("42501");
  });
});
