import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * A AGENDA DE PROFISSIONAIS (migration 0245) — o que o banco garante sozinho.
 *
 * ═══ O que este arquivo prova ═══
 *
 * 1. INSTALAÇÃO FRESCA: org nova + primeiro membro ativo ⇒ o membro vira
 *    profissional e todo tipo semeado fica habilitado para ele. Sem isto a
 *    agenda voltaria a nascer sem horário (o defeito que a 0195 fechou).
 * 2. BACKFILL: re-executa o bloco da 0245 TIRADO DO `baseline.sql` (o que o
 *    `update.sh` aplica) sobre dado legado, e mede: profissional para quem já
 *    aparecia na agenda, habilitação do dono padrão, principal em todo
 *    agendamento com dono, exceção apontando para o profissional. Rodando DUAS
 *    vezes, e com o operador tendo trocado a habilitação no meio: a segunda
 *    rodada não duplica nada e não desfaz a escolha.
 * 3. A GUARDA DE DUPLICATA POR PESSOA: a mesma profissional como principal num
 *    agendamento e apoio no outro, no mesmo instante, é 23505 — e cancelar libera.
 * 4. O ESPELHO: remarcar e cancelar o agendamento move os participantes; remarcar
 *    em cima da apoio falha no MESMO UPDATE.
 * 5. `fn_agenda_marcar`: atômica, recusa profissional de outra org (23503) e
 *    argumento inválido (22023), roda com a RLS de quem chama, e anon não executa.
 * 6. RLS/RBAC: viewer e agent não escrevem profissionais nem serviços; viewer não
 *    marca; a org B não enxerga os profissionais da A.
 *
 * Cada negativo tem o seu controle positivo — um arquivo só de "barra" fica
 * verde se a tabela sumir ou se a policy negar todo mundo.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** A última linha não-vazia — `set_config` e etiquetas de comando vêm antes. */
function ultimaLinha(saida: string): string {
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  const ultima = linhas[linhas.length - 1];
  if (ultima === undefined) throw new Error(`o comando não devolveu nada: ${saida}`);
  return ultima;
}

function numero(script: string): number {
  const n = ultimaLinha(sql(script));
  if (!/^\d+$/.test(n)) throw new Error(`saída inesperada do psql: ${n}`);
  return Number(n);
}

/**
 * Roda e devolve o SQLSTATE do erro, ou `null` se passou.
 *
 * `VERBOSITY verbose` põe o código na linha do erro (`ERROR:  23505: ...`). Sem
 * o código, "falhou" não distingue a guarda certa de um erro de digitação no
 * próprio teste — e o caso ficaria verde pelo motivo errado.
 */
function codigoDoErro(script: string): string | null {
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

function comoUsuario(userId: string, comando: string): string {
  return `
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${comando}
  `;
}

/** Tenta escrever COMO o usuário. Devolve se o banco deixou. */
function escreveComo(userId: string, comando: string): boolean {
  try {
    sql(comoUsuario(userId, comando));
    return true;
  } catch {
    return false;
  }
}

const ORG_A = "a9e00245-0000-4000-8000-00000000000a";
const ORG_B = "a9e00245-0000-4000-8000-00000000000b";
const ORG_LEGADO = "a9e00245-0000-4000-8000-00000000000c";
const DONO_A = "a9e00245-1111-4000-8000-000000000001";
const MANAGER_A = "a9e00245-1111-4000-8000-000000000002";
const AGENT_A = "a9e00245-1111-4000-8000-000000000003";
const VIEWER_A = "a9e00245-1111-4000-8000-000000000004";
const AGENT_B = "a9e00245-1111-4000-8000-000000000005";
const LEGADO_1 = "a9e00245-1111-4000-8000-000000000006";
const LEGADO_2 = "a9e00245-1111-4000-8000-000000000007";
/** Profissionais SEM login da org A. */
const BIA = "a9e00245-2222-4000-8000-000000000001";
const CARLA = "a9e00245-2222-4000-8000-000000000002";

function compromisso(titulo: string, inicio: string, fim: string): string {
  return `'${JSON.stringify({ title: titulo, starts_at: inicio, ends_at: fim })}'::jsonb`;
}

function marcar(titulo: string, inicio: string, fim: string, profissionais: string[], org = ORG_A): string {
  const lista = profissionais.map((p) => `'${p}'`).join(", ");
  return `select public.fn_agenda_marcar('${org}', ${compromisso(titulo, inicio, fim)}, array[${lista}]::uuid[]);`;
}

function idDoProfissional(org: string, userId: string): string {
  return ultimaLinha(
    sql(`select id from public.calendar_professionals
          where organization_id = '${org}' and user_id = '${userId}';`),
  );
}

/** O bloco da 0245 COMO O `update.sh` O APLICA: tirado do baseline, não da migration. */
function blocoDa0245NoBaseline(): string {
  const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
  const rotulo = "-- ---- agenda: profissionais, apoio, serviços e lembrete (migration 0245) ----";
  const inicio = baseline.indexOf(rotulo);
  const fim = baseline.indexOf("-- ---- VARREDURA anon:", inicio);
  if (inicio < 0 || fim < 0) {
    throw new Error("INSTRUMENTO: não achei o bloco da 0245 antes da VARREDURA anon no baseline.sql");
  }
  return baseline.slice(inicio, fim);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${DONO_A}',    'prof-dono-a@invariant.test', '{"full_name":"Ana Dona"}'),
      ('${MANAGER_A}', 'prof-mgr-a@invariant.test', '{}'),
      ('${AGENT_A}',   'prof-agent-a@invariant.test', '{}'),
      ('${VIEWER_A}',  'prof-viewer-a@invariant.test', '{}'),
      ('${AGENT_B}',   'prof-agent-b@invariant.test', '{}'),
      ('${LEGADO_1}',  'legado.um@invariant.test', '{}'),
      ('${LEGADO_2}',  'legado.dois@invariant.test', '{"full_name":"  "}')
      on conflict (id) do nothing;

    -- O trigger da 0185 semeia os três tipos em cada org nova.
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'prof-inv-a', 'Profissionais A', 'Prof A'),
      ('${ORG_B}', 'prof-inv-b', 'Profissionais B', 'Prof B'),
      ('${ORG_LEGADO}', 'prof-inv-legado', 'Profissionais Legado', 'Prof Legado')
      on conflict (id) do nothing;
  `);

  // O primeiro membro ATIVO entra SOZINHO, num statement próprio: é ele que a
  // 0195/0245 adota. (Num INSERT de várias linhas o trigger AFTER ROW roda no fim
  // do statement e cada linha vê a contagem final — ninguém seria o primeiro.)
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at)
       values ('${DONO_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;`);
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at)
       values ('${AGENT_B}', '${ORG_B}', 'agent', now()) on conflict do nothing;`);
  sql(`
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${VIEWER_A}',  '${ORG_A}', 'viewer',  now())
      on conflict do nothing;

    insert into public.calendar_professionals (id, organization_id, name) values
      ('${BIA}',   '${ORG_A}', 'Bia'),
      ('${CARLA}', '${ORG_A}', 'Carla')
      on conflict (id) do nothing;
  `);
});

describe("instalação fresca — o primeiro membro já nasce agendável", () => {
  it("o primeiro membro ativo vira profissional, com o nome do user_metadata", () => {
    const nome = ultimaLinha(
      sql(`select name from public.calendar_professionals
            where organization_id = '${ORG_A}' and user_id = '${DONO_A}';`),
    );
    expect(nome).toBe("Ana Dona");
  });

  it("todo tipo semeado da org fica habilitado para ele", () => {
    const tipos = numero(`select count(*) from public.calendar_event_types where organization_id = '${ORG_A}';`);
    const habilitados = numero(`
      select count(*) from public.calendar_event_type_professionals h
        join public.calendar_professionals p on p.id = h.professional_id
       where h.organization_id = '${ORG_A}' and p.user_id = '${DONO_A}';`);
    expect(tipos, "CONTROLE: a org nova não recebeu tipo nenhum — o seed quebrou").toBeGreaterThan(0);
    expect(habilitados).toBe(tipos);
  });

  it("o segundo membro NÃO vira profissional sozinho — só o primeiro é adotado", () => {
    // Mesma régua da 0195: adotar a cada membro novo poria a recepção na agenda.
    const doManager = numero(`select count(*) from public.calendar_professionals
                               where organization_id = '${ORG_A}' and user_id = '${MANAGER_A}';`);
    expect(doManager).toBe(0);
  });
});

describe("backfill — o bloco do baseline, re-aplicado sobre dado legado", () => {
  beforeAll(() => {
    // Org sem membro (ninguém é adotado) e agenda montada como antes da 0245:
    // dono por user_id, nenhum profissional.
    sql(`
      update public.calendar_event_types set default_owner_user_id = '${LEGADO_1}'
       where organization_id = '${ORG_LEGADO}' and slug = 'consulta';

      insert into public.calendar_appointments
        (organization_id, title, starts_at, ends_at, owner_user_id, status)
      values ('${ORG_LEGADO}', 'Consulta legada', '2027-05-03 13:00:00+00', '2027-05-03 13:30:00+00',
              '${LEGADO_1}', 'confirmed');

      insert into public.calendar_availability_exceptions
        (organization_id, user_id, exception_date, is_unavailable, reason)
      values ('${ORG_LEGADO}', '${LEGADO_2}', '2027-05-04', true, 'folga legada');
    `);
    expect(
      numero(`select count(*) from public.calendar_professionals where organization_id = '${ORG_LEGADO}';`),
      "CONTROLE: a org legada já tinha profissional antes do backfill — o caso não mediria nada",
    ).toBe(0);
    sql(blocoDa0245NoBaseline());
  });

  it("quem já aparecia na agenda vira profissional — dono de tipo/agendamento e dono de exceção", () => {
    const nomes = sql(`select name from public.calendar_professionals
                        where organization_id = '${ORG_LEGADO}' order by name;`)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // full_name em branco cai para a parte local do e-mail.
    expect(nomes).toEqual(["legado.dois", "legado.um"]);
  });

  it("o tipo com dono padrão habilita o profissional dele; tipo sem dono fica sem habilitação", () => {
    const daConsulta = numero(`
      select count(*) from public.calendar_event_type_professionals h
        join public.calendar_event_types t on t.id = h.event_type_id
        join public.calendar_professionals p on p.id = h.professional_id
       where t.organization_id = '${ORG_LEGADO}' and t.slug = 'consulta' and p.user_id = '${LEGADO_1}';`);
    const dosOutros = numero(`
      select count(*) from public.calendar_event_type_professionals h
        join public.calendar_event_types t on t.id = h.event_type_id
       where t.organization_id = '${ORG_LEGADO}' and t.slug <> 'consulta';`);
    expect(daConsulta).toBe(1);
    expect(dosOutros).toBe(0);
  });

  it("o agendamento com dono ganha a principal, com horário e situação espelhados", () => {
    const linha = ultimaLinha(
      sql(`select c.role || '|' || c.status || '|' || (c.starts_at = a.starts_at)::text
             from public.calendar_appointment_professionals c
             join public.calendar_appointments a on a.id = c.appointment_id
             join public.calendar_professionals p on p.id = c.professional_id
            where a.organization_id = '${ORG_LEGADO}' and p.user_id = '${LEGADO_1}';`),
    );
    expect(linha).toBe("principal|confirmed|true");
  });

  it("a exceção passa a apontar para o profissional do dono", () => {
    const semProfissional = numero(`select count(*) from public.calendar_availability_exceptions
                                     where organization_id = '${ORG_LEGADO}' and professional_id is null;`);
    const doLegado2 = numero(`
      select count(*) from public.calendar_availability_exceptions e
        join public.calendar_professionals p on p.id = e.professional_id
       where e.organization_id = '${ORG_LEGADO}' and p.user_id = '${LEGADO_2}';`);
    expect(semProfissional).toBe(0);
    expect(doLegado2).toBe(1);
  });

  it("re-aplicar não duplica nada e NÃO desfaz a habilitação que o operador trocou", () => {
    // O operador tira o dono padrão da consulta e põe a outra profissional.
    sql(`
      delete from public.calendar_event_type_professionals h
       using public.calendar_event_types t
       where t.id = h.event_type_id and t.organization_id = '${ORG_LEGADO}' and t.slug = 'consulta';
      insert into public.calendar_event_type_professionals (organization_id, event_type_id, professional_id)
      select t.organization_id, t.id, p.id
        from public.calendar_event_types t
        join public.calendar_professionals p on p.organization_id = t.organization_id and p.user_id = '${LEGADO_2}'
       where t.organization_id = '${ORG_LEGADO}' and t.slug = 'consulta';
    `);
    const contar = () =>
      ultimaLinha(
        sql(`select
               (select count(*) from public.calendar_professionals where organization_id = '${ORG_LEGADO}') || '|' ||
               (select count(*) from public.calendar_appointment_professionals where organization_id = '${ORG_LEGADO}') || '|' ||
               (select count(*) from public.calendar_event_type_professionals where organization_id = '${ORG_LEGADO}');`),
      );
    const antes = contar();

    sql(blocoDa0245NoBaseline());

    expect(contar()).toBe(antes);
    const daConsulta = sql(`
      select p.name from public.calendar_event_type_professionals h
        join public.calendar_event_types t on t.id = h.event_type_id
        join public.calendar_professionals p on p.id = h.professional_id
       where t.organization_id = '${ORG_LEGADO}' and t.slug = 'consulta';`);
    expect(daConsulta).toBe("legado.dois");
  });
});

describe("a guarda de duplicata vale por PESSOA, seja principal ou apoio", () => {
  const T = "2027-03-10T13:00:00Z";
  const T_FIM = "2027-03-10T13:30:00Z";

  it("CONTROLE: Bia como principal às 13h entra", () => {
    expect(codigoDoErro(marcar("Bia principal", T, T_FIM, [BIA]))).toBeNull();
  });

  it("Bia como APOIO de outro agendamento no mesmo instante é 23505 — e nada fica gravado", () => {
    expect(codigoDoErro(marcar("Carla com Bia de apoio", T, T_FIM, [CARLA, BIA]))).toBe("23505");
    // Atômica: o agendamento da Carla não sobrou sem participante.
    expect(
      numero(`select count(*) from public.calendar_appointments
               where organization_id = '${ORG_A}' and title = 'Carla com Bia de apoio';`),
    ).toBe(0);
  });

  it("cancelar o primeiro libera o instante — a guarda é só sobre o que está de pé", () => {
    sql(`update public.calendar_appointments set status = 'cancelled', cancelled_at = now()
          where organization_id = '${ORG_A}' and title = 'Bia principal';`);
    expect(codigoDoErro(marcar("Carla com Bia de apoio", T, T_FIM, [CARLA, BIA]))).toBeNull();
  });
});

describe("o espelho acompanha o agendamento", () => {
  it("remarcar move principal E apoio; cancelar muda a situação das duas", () => {
    const id = ultimaLinha(
      sql(marcar("Espelho", "2027-03-11T13:00:00Z", "2027-03-11T14:00:00Z", [BIA, CARLA])),
    );
    sql(`update public.calendar_appointments
            set starts_at = '2027-03-11T15:00:00Z', ends_at = '2027-03-11T16:00:00Z'
          where id = '${id}';`);
    expect(
      numero(`select count(*) from public.calendar_appointment_professionals
               where appointment_id = '${id}' and starts_at = '2027-03-11T15:00:00Z'
                 and ends_at = '2027-03-11T16:00:00Z';`),
    ).toBe(2);

    sql(`update public.calendar_appointments set status = 'cancelled', cancelled_at = now() where id = '${id}';`);
    expect(
      numero(`select count(*) from public.calendar_appointment_professionals
               where appointment_id = '${id}' and status = 'cancelled';`),
    ).toBe(2);
  });

  it("remarcar em cima de um horário em que a APOIO já está falha no mesmo UPDATE", () => {
    sql(marcar("Carla às 9h", "2027-03-12T12:00:00Z", "2027-03-12T12:30:00Z", [CARLA]));
    const id = ultimaLinha(
      sql(marcar("Bia com Carla às 10h", "2027-03-12T13:00:00Z", "2027-03-12T13:30:00Z", [BIA, CARLA])),
    );
    expect(
      codigoDoErro(`update public.calendar_appointments
                       set starts_at = '2027-03-12T12:00:00Z', ends_at = '2027-03-12T12:30:00Z'
                     where id = '${id}';`),
    ).toBe("23505");
    // E o agendamento ficou onde estava.
    expect(
      numero(`select count(*) from public.calendar_appointments
               where id = '${id}' and starts_at = '2027-03-12T13:00:00Z';`),
    ).toBe(1);
  });
});

describe("fn_agenda_marcar — a porta atômica", () => {
  it("profissional de OUTRA organização bate na FK composta (23503) e nada fica gravado", () => {
    const daOrgB = idDoProfissional(ORG_B, AGENT_B);
    expect(codigoDoErro(marcar("Cruzado", "2027-03-13T13:00:00Z", "2027-03-13T13:30:00Z", [daOrgB]))).toBe(
      "23503",
    );
    expect(
      numero(`select count(*) from public.calendar_appointments where title = 'Cruzado';`),
    ).toBe(0);
  });

  it("zero, três ou repetida é 22023 — e não 23505, que a rota leria como 'ocupado'", () => {
    const inicio = "2027-03-14T13:00:00Z";
    const fim = "2027-03-14T13:30:00Z";
    expect(codigoDoErro(marcar("Vazio", inicio, fim, []))).toBe("22023");
    expect(codigoDoErro(marcar("Três", inicio, fim, [BIA, CARLA, idDoProfissional(ORG_A, DONO_A)]))).toBe("22023");
    expect(codigoDoErro(marcar("Repetida", inicio, fim, [BIA, BIA]))).toBe("22023");
  });

  it("roda com a RLS de quem chama: o agent marca, o viewer não", () => {
    const pelaTela = (quem: string, titulo: string, inicio: string, fim: string) =>
      escreveComo(quem, marcar(titulo, inicio, fim, [CARLA]));
    expect(pelaTela(VIEWER_A, "do viewer", "2027-03-15T13:00:00Z", "2027-03-15T13:30:00Z")).toBe(false);
    expect(pelaTela(AGENT_A, "do agent", "2027-03-15T14:00:00Z", "2027-03-15T14:30:00Z")).toBe(true);
  });

  it("anon NÃO executa fn_agenda_marcar; authenticated executa (controle)", () => {
    const linha = ultimaLinha(
      sql(`select has_function_privilege('anon', 'public.fn_agenda_marcar(uuid, jsonb, uuid[])', 'EXECUTE')::text
                  || '|' ||
                  has_function_privilege('authenticated', 'public.fn_agenda_marcar(uuid, jsonb, uuid[])', 'EXECUTE')::text;`),
    );
    expect(linha).toBe("false|true");
  });

  it("a função do espelho não é executável por anon nem por authenticated", () => {
    const linha = ultimaLinha(
      sql(`select has_function_privilege('anon', 'public.fn_agenda_participantes_acompanham()', 'EXECUTE')::text
                  || '|' ||
                  has_function_privilege('authenticated', 'public.fn_agenda_participantes_acompanham()', 'EXECUTE')::text;`),
    );
    expect(linha).toBe("false|false");
  });
});

describe("RLS — profissionais e serviços são configuração (manager+)", () => {
  function novoProfissional(quem: string, nome: string): boolean {
    return escreveComo(
      quem,
      `insert into public.calendar_professionals (organization_id, name) values ('${ORG_A}', '${nome}');`,
    );
  }

  it("o viewer NÃO cria profissional", () => {
    expect(novoProfissional(VIEWER_A, "do viewer")).toBe(false);
  });

  it("o agent NÃO cria profissional", () => {
    expect(novoProfissional(AGENT_A, "do agent")).toBe(false);
  });

  it("...e o manager cria (senão a proteção seria a feature quebrada)", () => {
    expect(novoProfissional(MANAGER_A, "do manager")).toBe(true);
  });

  it("o agent NÃO habilita profissional num tipo; o manager habilita", () => {
    const habilitar = (quem: string) =>
      escreveComo(
        quem,
        `insert into public.calendar_event_type_professionals (organization_id, event_type_id, professional_id)
         select t.organization_id, t.id, '${CARLA}' from public.calendar_event_types t
          where t.organization_id = '${ORG_A}' and t.slug = 'reuniao';`,
      );
    expect(habilitar(AGENT_A)).toBe(false);
    expect(habilitar(MANAGER_A)).toBe(true);
  });

  it("o viewer LÊ os profissionais da própria org (o gate é de escrita)", () => {
    expect(
      numero(comoUsuario(VIEWER_A, `select count(*) from public.calendar_professionals where organization_id = '${ORG_A}';`)),
    ).toBeGreaterThan(0);
  });

  it("a org B NÃO enxerga os profissionais da A", () => {
    expect(
      numero(comoUsuario(AGENT_B, `select count(*) from public.calendar_professionals where organization_id = '${ORG_A}';`)),
    ).toBe(0);
    // Controle: o agent da B enxerga os da própria.
    expect(
      numero(comoUsuario(AGENT_B, `select count(*) from public.calendar_professionals where organization_id = '${ORG_B}';`)),
    ).toBeGreaterThan(0);
  });
});
