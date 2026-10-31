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
 * 5. `fn_agenda_marcar`: atômica, recusa argumento inválido (22023), roda com a
 *    RLS de quem chama, e anon não executa.
 * 6. RLS/RBAC: viewer e agent não escrevem profissionais nem serviços; viewer não
 *    marca; a org B não enxerga os profissionais da A.
 * 7. A FUNÇÃO É PORTA: chamada DIRETO (sessão de agent, como o PostgREST faria,
 *    sem a rota), ela mesma recusa tipo/contato/conversa/profissional/agente de
 *    outra organização, conversa de outro contato, tipo desativado, quantidade
 *    errada e profissional não habilitada — cada uma com o seu hint. E decide
 *    sozinha `status`, `owner_user_id` e a autoria com sessão.
 * 8. SOBREPOSIÇÃO PARCIAL (10:00–11:00 × 10:30–11:30) da mesma profissional é
 *    23505 — como principal, como apoio, contra o legado por dono, e ao remarcar.
 * 9. O ESPELHO É SÓ DO TRIGGER: o agent não dá UPDATE nem DELETE na tabela de
 *    participantes; remarcar pelo agendamento continua movendo a cópia.
 * 10. `booked_at` nasce, é recarimbado ao mudar `starts_at`, e o backfill grava
 *     `created_at` SEM mexer em `updated_at` (senão a agenda inteira voltaria
 *     ao Google).
 * 11. Re-aplicar o bloco da 0194 do baseline NÃO desliga um lembrete ligado.
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

/**
 * Como `codigoDoErro`, e também o HINT — é por ele que a rota escolhe o código
 * de API (`agenda:<motivo>`, contrato no comentário da migration 0245).
 */
function erroDe(script: string): { codigo: string; dica: string | null } | null {
  try {
    sql(`\\set VERBOSITY verbose\n${script}`);
    return null;
  } catch (e) {
    const saida = String((e as { stderr?: unknown }).stderr ?? e);
    const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(saida);
    if (!m) throw new Error(`falhou sem SQLSTATE legível: ${saida}`);
    const h = /HINT:\s+(\S+)/.exec(saida);
    return { codigo: m[1] as string, dica: h ? (h[1] as string) : null };
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
/** Desativada — recusada pela função mesmo sendo da org. */
const DORA = "a9e00245-2222-4000-8000-000000000003";

/**
 * Tipos PRÓPRIOS deste arquivo na org A, criados DEPOIS do primeiro membro — senão
 * a adoção da 0195/0245 os habilitaria para o dono e Bia/Carla não serviriam.
 * Sem habilitação = qualquer profissional ativa.
 */
const TIPO_UM = "a9e00245-3333-4000-8000-000000000001";
const TIPO_DOIS = "a9e00245-3333-4000-8000-000000000002";
const TIPO_INATIVO = "a9e00245-3333-4000-8000-000000000003";
const TIPO_CONFIRMA = "a9e00245-3333-4000-8000-000000000004";
/** Com habilitação: só a Carla faz. */
const TIPO_SO_CARLA = "a9e00245-3333-4000-8000-000000000005";
const TIPO_B = "a9e00245-3333-4000-8000-00000000000b";
const TIPOS_DESTE_ARQUIVO = [TIPO_UM, TIPO_DOIS, TIPO_INATIVO, TIPO_CONFIRMA, TIPO_SO_CARLA];

const SESSAO_A = "a9e00245-4444-4000-8000-00000000000a";
const SESSAO_B = "a9e00245-4444-4000-8000-00000000000b";
const CONTATO_A = "a9e00245-5555-4000-8000-000000000001";
const CONTATO_A2 = "a9e00245-5555-4000-8000-000000000002";
const CONTATO_B = "a9e00245-5555-4000-8000-00000000000b";
const CONVERSA_A = "a9e00245-6666-4000-8000-000000000001";
const CONVERSA_A2 = "a9e00245-6666-4000-8000-000000000002";
const CONVERSA_B = "a9e00245-6666-4000-8000-00000000000b";
const AGENTE_IA_A = "a9e00245-7777-4000-8000-00000000000a";
const AGENTE_IA_B = "a9e00245-7777-4000-8000-00000000000b";

/** O tipo pela quantidade: 2 profissionais → o que pede duas; o resto → o de uma. */
function tipoPara(profissionais: string[]): string {
  return profissionais.length === 2 ? TIPO_DOIS : TIPO_UM;
}

function compromisso(titulo: string, inicio: string, fim: string, extra: Record<string, unknown> = {}): string {
  return `'${JSON.stringify({ title: titulo, starts_at: inicio, ends_at: fim, ...extra })}'::jsonb`;
}

function marcar(
  titulo: string,
  inicio: string,
  fim: string,
  profissionais: string[],
  org = ORG_A,
  extra: Record<string, unknown> = {},
): string {
  const lista = profissionais.map((p) => `'${p}'`).join(", ");
  const campos = { event_type_id: tipoPara(profissionais), ...extra };
  return `select public.fn_agenda_marcar('${org}', ${compromisso(titulo, inicio, fim, campos)}, array[${lista}]::uuid[]);`;
}

/** Uma linha do agendamento gravado, por título, como texto `a|b|c`. */
function gravado(titulo: string, colunas: string): string {
  return ultimaLinha(
    sql(`select concat_ws('|', ${colunas}) from public.calendar_appointments
          where organization_id = '${ORG_A}' and title = '${titulo}';`),
  );
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
    insert into public.calendar_professionals (id, organization_id, name, is_active)
      values ('${DORA}', '${ORG_A}', 'Dora', false)
      on conflict (id) do nothing;

    -- Os tipos deste arquivo — DEPOIS do primeiro membro (ver TIPO_UM).
    insert into public.calendar_event_types
      (id, organization_id, name, slug, category, duration_minutes, professionals_required,
       is_active, requires_confirmation)
    values
      ('${TIPO_UM}',       '${ORG_A}', 'Uma',        'inv0245-uma',        'consulta', 30, 1, true,  false),
      ('${TIPO_DOIS}',     '${ORG_A}', 'Duas',       'inv0245-duas',       'consulta', 30, 2, true,  false),
      ('${TIPO_INATIVO}',  '${ORG_A}', 'Inativo',    'inv0245-inativo',    'consulta', 30, 1, false, false),
      ('${TIPO_CONFIRMA}', '${ORG_A}', 'Confirma',   'inv0245-confirma',   'consulta', 30, 1, true,  true),
      ('${TIPO_SO_CARLA}', '${ORG_A}', 'So a Carla', 'inv0245-so-carla',   'consulta', 30, 1, true,  false),
      ('${TIPO_B}',        '${ORG_B}', 'Da B',       'inv0245-da-b',       'consulta', 30, 1, true,  false)
      on conflict (id) do nothing;
    insert into public.calendar_event_type_professionals (organization_id, event_type_id, professional_id)
      values ('${ORG_A}', '${TIPO_SO_CARLA}', '${CARLA}')
      on conflict do nothing;

    -- Contatos e conversas dos dois lados: é o que o lembrete usa para sair.
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESSAO_A}', '${ORG_A}', 'inv0245-a', '\\x00'::bytea),
      ('${SESSAO_B}', '${ORG_B}', 'inv0245-b', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, name) values
      ('${CONTATO_A}',  '${ORG_A}', 'Cliente A'),
      ('${CONTATO_A2}', '${ORG_A}', 'Outra cliente A'),
      ('${CONTATO_B}',  '${ORG_B}', 'Cliente B')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA_A}',  '${ORG_A}', '${CONTATO_A}',  '${SESSAO_A}', 'open'),
      ('${CONVERSA_A2}', '${ORG_A}', '${CONTATO_A2}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_B}',  '${ORG_B}', '${CONTATO_B}',  '${SESSAO_B}', 'open')
      on conflict (id) do nothing;
    insert into public.ai_agents (id, organization_id, name, system_prompt) values
      ('${AGENTE_IA_A}', '${ORG_A}', 'Agente A', 'prompt'),
      ('${AGENTE_IA_B}', '${ORG_B}', 'Agente B', 'prompt')
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
    // Os tipos que este arquivo cria DEPOIS da adoção ficam de fora: o que se
    // mede aqui é o que a org tinha quando o primeiro membro chegou.
    const fora = TIPOS_DESTE_ARQUIVO.map((t) => `'${t}'`).join(", ");
    const tipos = numero(`select count(*) from public.calendar_event_types
                           where organization_id = '${ORG_A}' and id not in (${fora});`);
    const habilitados = numero(`
      select count(*) from public.calendar_event_type_professionals h
        join public.calendar_professionals p on p.id = h.professional_id
       where h.organization_id = '${ORG_A}' and p.user_id = '${DONO_A}'
         and h.event_type_id not in (${fora});`);
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
  it("profissional de OUTRA organização é recusada pela própria função, com o hint — e nada fica gravado", () => {
    // Antes da conferência, quem barrava era a FK composta (23503) — DEPOIS de o
    // agendamento já ter sido inserido. Agora a recusa vem antes, e nomeada.
    const daOrgB = idDoProfissional(ORG_B, AGENT_B);
    expect(erroDe(marcar("Cruzado", "2027-03-13T13:00:00Z", "2027-03-13T13:30:00Z", [daOrgB]))).toEqual({
      codigo: "P0001",
      dica: "agenda:profissional_invalido",
    });
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

  it("o espelho é DEFINER (move a cópia sem UPDATE de quem remarca); o carimbo de booked_at é fechado", () => {
    const linha = ultimaLinha(
      sql(`select (select prosecdef from pg_proc where oid = 'public.fn_agenda_participantes_acompanham()'::regprocedure)::text
                  || '|' ||
                  has_function_privilege('anon', 'public.fn_agenda_horario_fixado()', 'EXECUTE')::text
                  || '|' ||
                  has_function_privilege('authenticated', 'public.fn_agenda_horario_fixado()', 'EXECUTE')::text;`),
    );
    expect(linha).toBe("true|false|false");
  });

  it("a reconferência sob trava: anon NÃO executa; authenticated executa (a fn_agenda_marcar é invoker)", () => {
    const assinatura = "public.fn_agenda_conferir_livre(uuid, uuid[], timestamptz, timestamptz, uuid)";
    const linha = ultimaLinha(
      sql(`select has_function_privilege('anon', '${assinatura}', 'EXECUTE')::text
                  || '|' ||
                  has_function_privilege('authenticated', '${assinatura}', 'EXECUTE')::text;`),
    );
    expect(linha).toBe("false|true");
  });
});

/**
 * A FUNÇÃO É PORTA, NÃO SÓ ATALHO.
 *
 * `authenticated` tem EXECUTE na `fn_agenda_marcar`: uma sessão de agent a chama
 * pelo PostgREST sem passar pela rota. Cada caso abaixo é a chamada DIRETA, com a
 * sessão do agent da org A — e a FK simples de `contact_id`/`conversation_id`
 * não olha organização (e FK ignora RLS), então sem a conferência da própria
 * função o cliente da B seria gravado na agenda da A.
 */
describe("fn_agenda_marcar chamada direto — a função confere sozinha", () => {
  const T = "2027-06-01T13:00:00Z";
  const T_FIM = "2027-06-01T13:30:00Z";
  const pelaSessao = (script: string) => comoUsuario(AGENT_A, script);

  it.each([
    ["contato de OUTRA organização", [BIA], { contact_id: CONTATO_B }, "agenda:contato_inexistente"],
    ["conversa de OUTRA organização", [BIA], { conversation_id: CONVERSA_B }, "agenda:conversa_inexistente"],
    [
      "conversa da org, mas de OUTRO contato",
      [BIA],
      { contact_id: CONTATO_A, conversation_id: CONVERSA_A2 },
      "agenda:conversa_de_outro_contato",
    ],
    ["tipo de OUTRA organização", [BIA], { event_type_id: TIPO_B }, "agenda:tipo_inexistente"],
    ["tipo desativado", [BIA], { event_type_id: TIPO_INATIVO }, "agenda:tipo_desativado"],
    ["tipo que pede DUAS com uma só", [BIA], { event_type_id: TIPO_DOIS }, "agenda:profissionais_insuficientes"],
    ["tipo que pede UMA com duas", [BIA, CARLA], { event_type_id: TIPO_UM }, "agenda:profissionais_insuficientes"],
    ["profissional desativada", [DORA], {}, "agenda:profissional_invalido"],
    ["profissional não habilitada num tipo COM habilitação", [BIA], { event_type_id: TIPO_SO_CARLA }, "agenda:profissional_invalido"],
    ["owner_user_id que não é o login da principal", [BIA], { owner_user_id: MANAGER_A }, "agenda:profissional_invalido"],
  ] as const)("%s → P0001 com o hint certo, e nada gravado", (titulo, profissionais, extra, dica) => {
    expect(erroDe(pelaSessao(marcar(titulo, T, T_FIM, [...profissionais], ORG_A, { ...extra })))).toEqual({
      codigo: "P0001",
      dica,
    });
    expect(numero(`select count(*) from public.calendar_appointments where title = '${titulo}';`)).toBe(0);
  });

  it("profissional de OUTRA organização, pela sessão do agent: recusada antes do INSERT", () => {
    const daOrgB = idDoProfissional(ORG_B, AGENT_B);
    expect(erroDe(pelaSessao(marcar("Cruzado pela sessão", T, T_FIM, [daOrgB])))).toEqual({
      codigo: "P0001",
      dica: "agenda:profissional_invalido",
    });
  });

  it("CONTROLE: contato e conversa da casa, pela sessão do agent, passam e ficam gravados", () => {
    expect(
      erroDe(pelaSessao(marcar("Da casa", T, T_FIM, [BIA], ORG_A, { contact_id: CONTATO_A, conversation_id: CONVERSA_A }))),
    ).toBeNull();
    expect(gravado("Da casa", "contact_id, conversation_id")).toBe(`${CONTATO_A}|${CONVERSA_A}`);
  });

  it("sem contato no pedido, a conversa define quem é atendido", () => {
    expect(
      erroDe(marcar("Pela conversa", "2027-06-01T15:00:00Z", "2027-06-01T15:30:00Z", [CARLA], ORG_A, {
        conversation_id: CONVERSA_A2,
      })),
    ).toBeNull();
    expect(gravado("Pela conversa", "contact_id")).toBe(CONTATO_A2);
  });

  it("o status é do TIPO, não de quem chama: pedir `confirmed` num tipo que exige confirmação grava `pending`", () => {
    sql(marcar("Quer confirmar", "2027-06-02T13:00:00Z", "2027-06-02T13:30:00Z", [BIA], ORG_A, {
      event_type_id: TIPO_CONFIRMA,
      status: "confirmed",
    }));
    sql(marcar("Quer pendente", "2027-06-02T14:00:00Z", "2027-06-02T14:30:00Z", [BIA], ORG_A, {
      status: "pending",
    }));
    expect(gravado("Quer confirmar", "status")).toBe("pending");
    expect(gravado("Quer pendente", "status")).toBe("confirmed");
  });

  it("COM sessão, a autoria é a sessão — o jsonb não escolhe usuário, agente nem origem", () => {
    sql(
      pelaSessao(
        marcar("Autoria forjada", "2027-06-03T13:00:00Z", "2027-06-03T13:30:00Z", [BIA], ORG_A, {
          created_by_user_id: MANAGER_A,
          created_by_kind: "ai",
          created_by_agent_id: AGENTE_IA_A,
          source: "mcp",
        }),
      ),
    );
    expect(
      gravado(
        "Autoria forjada",
        "coalesce(created_by_user_id::text, '-'), created_by_kind, coalesce(created_by_agent_id::text, '-'), source",
      ),
    ).toBe(`${AGENT_A}|user|-|ui`);
  });

  it("SEM sessão (service_role), o agente de OUTRA organização é recusado — e o da casa grava", () => {
    expect(
      erroDe(marcar("Agente alheio", "2027-06-03T15:00:00Z", "2027-06-03T15:30:00Z", [BIA], ORG_A, {
        created_by_kind: "ai",
        created_by_agent_id: AGENTE_IA_B,
        source: "mcp",
      })),
    ).toEqual({ codigo: "P0001", dica: "agenda:agente_inexistente" });
    expect(
      erroDe(marcar("Agente da casa", "2027-06-03T16:00:00Z", "2027-06-03T16:30:00Z", [BIA], ORG_A, {
        created_by_kind: "ai",
        created_by_agent_id: AGENTE_IA_A,
        source: "mcp",
      })),
    ).toBeNull();
    expect(gravado("Agente da casa", "created_by_kind, created_by_agent_id, source")).toBe(`ai|${AGENTE_IA_A}|mcp`);
  });

  it("o dono é DERIVADO da principal: sem owner_user_id no pedido, grava o login dela", () => {
    const doDono = idDoProfissional(ORG_A, DONO_A);
    sql(marcar("Dono derivado", "2027-06-04T13:00:00Z", "2027-06-04T13:30:00Z", [doDono]));
    sql(marcar("Sem login, sem dono", "2027-06-04T14:00:00Z", "2027-06-04T14:30:00Z", [BIA]));
    expect(gravado("Dono derivado", "owner_user_id")).toBe(DONO_A);
    expect(gravado("Sem login, sem dono", "coalesce(owner_user_id::text, '-')")).toBe("-");
  });
});

/**
 * Quem SAIU da equipe não atende — nem pela porta da função, nem na oferta.
 * A linha de profissional pode sobrar ATIVA (a desativação na revogação é
 * best-effort); a função exige membro ativo, e o backfill do baseline a desliga.
 */
describe("ex-membro (vínculo revogado) não atende", () => {
  const EX = "a9e00245-1111-4000-8000-000000000009";
  const EX_PROF = "a9e00245-2222-4000-8000-000000000009";

  beforeAll(() => {
    // Criado AQUI, e não no beforeAll do topo: o bloco do baseline já rodou antes
    // (describe do backfill) e o teria desligado antes de o caso medir a função.
    sql(`
      insert into auth.users (id, email) values ('${EX}', 'prof-ex-a@invariant.test') on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at)
        values ('${EX}', '${ORG_A}', 'agent', now(), now()) on conflict do nothing;
      insert into public.calendar_professionals (id, organization_id, user_id, name, is_active)
        values ('${EX_PROF}', '${ORG_A}', '${EX}', 'Ex da equipe', true) on conflict (id) do nothing;
    `);
  });

  it("a função recusa a profissional ATIVA de quem foi revogado", () => {
    expect(erroDe(marcar("Com ex-membro", "2027-06-05T13:00:00Z", "2027-06-05T13:30:00Z", [EX_PROF]))).toEqual({
      codigo: "P0001",
      dica: "agenda:profissional_invalido",
    });
    expect(numero(`select count(*) from public.calendar_appointments where title = 'Com ex-membro';`)).toBe(0);
  });

  it("re-aplicar o bloco do baseline desliga a linha — e a segunda rodada não muda nada", () => {
    const ativa = () =>
      ultimaLinha(sql(`select is_active::text from public.calendar_professionals where id = '${EX_PROF}';`));
    expect(ativa(), "CONTROLE: a linha precisa partir ativa, senão o caso não mede o backfill").toBe("true");
    sql(blocoDa0245NoBaseline());
    expect(ativa()).toBe("false");
    // Controle: a profissional de quem continua na equipe NÃO foi desligada.
    expect(
      ultimaLinha(
        sql(`select is_active::text from public.calendar_professionals
              where organization_id = '${ORG_A}' and user_id = '${DONO_A}';`),
      ),
    ).toBe("true");
    sql(blocoDa0245NoBaseline());
    expect(ativa()).toBe("false");
  });
});

/**
 * O índice `cap_sem_duplicata_idx` só enxerga o MESMO instante. Estes casos são o
 * que ele deixava passar — e que a trava + reconferência fecha.
 */
describe("sobreposição parcial da mesma profissional é 23505", () => {
  const ocupado = { codigo: "23505", dica: "agenda:horario_ocupado" };

  it("CONTROLE: Bia das 10h às 11h entra", () => {
    expect(erroDe(marcar("Bia 10h", "2027-06-10T13:00:00Z", "2027-06-10T14:00:00Z", [BIA]))).toBeNull();
  });

  it("Bia das 10h30 às 11h30 como PRINCIPAL é recusada", () => {
    expect(erroDe(marcar("Bia 10h30", "2027-06-10T13:30:00Z", "2027-06-10T14:30:00Z", [BIA]))).toEqual(ocupado);
    expect(numero(`select count(*) from public.calendar_appointments where title = 'Bia 10h30';`)).toBe(0);
  });

  it("...e como APOIO também — e o agendamento da principal não sobra sem participante", () => {
    expect(
      erroDe(marcar("Carla com Bia 10h30", "2027-06-10T13:30:00Z", "2027-06-10T14:30:00Z", [CARLA, BIA])),
    ).toEqual(ocupado);
    expect(numero(`select count(*) from public.calendar_appointments where title = 'Carla com Bia 10h30';`)).toBe(0);
  });

  it("CONTROLE: encostado (11h às 12h) não é sobreposição", () => {
    expect(erroDe(marcar("Bia 11h", "2027-06-10T14:00:00Z", "2027-06-10T15:00:00Z", [BIA]))).toBeNull();
  });

  it("o legado por DONO, sem participante, também ocupa", () => {
    // Agendamento anterior à 0245 que não ganhou participante: só `owner_user_id`.
    sql(`insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, owner_user_id, status)
         values ('${ORG_A}', 'Legado do dono', '2027-06-11T13:00:00Z', '2027-06-11T14:00:00Z', '${DONO_A}', 'confirmed');`);
    const doDono = idDoProfissional(ORG_A, DONO_A);
    expect(erroDe(marcar("Em cima do legado", "2027-06-11T13:30:00Z", "2027-06-11T14:30:00Z", [doDono]))).toEqual(
      ocupado,
    );
  });

  it("REMARCAR para um horário que sobrepõe a principal falha, e o agendamento fica onde estava", () => {
    sql(marcar("Carla 15h", "2027-06-12T15:00:00Z", "2027-06-12T16:00:00Z", [CARLA]));
    const id = ultimaLinha(sql(marcar("Carla 17h", "2027-06-12T17:00:00Z", "2027-06-12T18:00:00Z", [CARLA])));
    expect(
      erroDe(`update public.calendar_appointments
                 set starts_at = '2027-06-12T15:30:00Z', ends_at = '2027-06-12T16:30:00Z'
               where id = '${id}';`),
    ).toEqual(ocupado);
    expect(gravado("Carla 17h", "(starts_at = '2027-06-12T17:00:00Z')::text")).toBe("true");

    // Controle: encostado entra.
    expect(
      erroDe(`update public.calendar_appointments
                 set starts_at = '2027-06-12T16:00:00Z', ends_at = '2027-06-12T17:00:00Z'
               where id = '${id}';`),
    ).toBeNull();
  });

  it("REMARCAR para cima de onde ela é APOIO também falha", () => {
    sql(marcar("Bia e Carla 19h", "2027-06-12T19:00:00Z", "2027-06-12T20:00:00Z", [BIA, CARLA]));
    const id = ultimaLinha(sql(marcar("Carla 21h", "2027-06-12T21:00:00Z", "2027-06-12T22:00:00Z", [CARLA])));
    expect(
      erroDe(`update public.calendar_appointments
                 set starts_at = '2027-06-12T19:30:00Z', ends_at = '2027-06-12T20:30:00Z'
               where id = '${id}';`),
    ).toEqual(ocupado);
  });

  it("CONTROLE: confirmar um pendente no MESMO horário não reconfere (encaixe legado não vira 23505)", () => {
    const id = ultimaLinha(
      sql(marcar("Pendente 8h", "2027-06-13T11:00:00Z", "2027-06-13T11:30:00Z", [BIA], ORG_A, {
        event_type_id: TIPO_CONFIRMA,
      })),
    );
    expect(erroDe(`update public.calendar_appointments set status = 'confirmed' where id = '${id}';`)).toBeNull();
  });
});

describe("o espelho é só do trigger — ninguém edita a cópia pelo PostgREST", () => {
  let id = "";
  beforeAll(() => {
    // Marcado PELA SESSÃO do agent: desde a 0249 ele só remarca o que vê (dono,
    // participante ou quem criou), e o CONTROLE abaixo remarca como ele. Pelo
    // service role, o agendamento da Bia (sem login) não seria dele, o UPDATE
    // alcançaria zero linhas sem erro — e o controle cairia pelo motivo errado.
    id = ultimaLinha(
      sql(comoUsuario(AGENT_A, marcar("Espelho travado", "2027-06-20T13:00:00Z", "2027-06-20T13:30:00Z", [BIA]))),
    );
  });

  it("o agent NÃO dá UPDATE na cópia (tiraria a profissional da guarda sem mexer no agendamento)", () => {
    expect(
      escreveComo(
        AGENT_A,
        `update public.calendar_appointment_professionals set starts_at = '2027-06-20T18:00:00Z'
          where appointment_id = '${id}';`,
      ),
    ).toBe(false);
  });

  it("nem o manager — o privilégio não existe para `authenticated`", () => {
    expect(
      escreveComo(
        MANAGER_A,
        `update public.calendar_appointment_professionals set status = 'cancelled' where appointment_id = '${id}';`,
      ),
    ).toBe(false);
  });

  it("o agent NÃO apaga participante", () => {
    expect(
      escreveComo(AGENT_A, `delete from public.calendar_appointment_professionals where appointment_id = '${id}';`),
    ).toBe(false);
    expect(numero(`select count(*) from public.calendar_appointment_professionals where appointment_id = '${id}';`)).toBe(1);
  });

  it("CONTROLE: o agent remarca PELO AGENDAMENTO, e a cópia acompanha (o espelho é definer)", () => {
    expect(
      escreveComo(
        AGENT_A,
        `update public.calendar_appointments
            set starts_at = '2027-06-20T15:00:00Z', ends_at = '2027-06-20T15:30:00Z'
          where id = '${id}';`,
      ),
    ).toBe(true);
    expect(
      numero(`select count(*) from public.calendar_appointment_professionals
               where appointment_id = '${id}' and starts_at = '2027-06-20T15:00:00Z';`),
    ).toBe(1);
  });

  it("no catálogo: authenticated tem INSERT e não tem UPDATE nem DELETE", () => {
    const linha = ultimaLinha(
      sql(`select has_table_privilege('authenticated', 'public.calendar_appointment_professionals', 'INSERT')::text
                  || '|' || has_table_privilege('authenticated', 'public.calendar_appointment_professionals', 'UPDATE')::text
                  || '|' || has_table_privilege('authenticated', 'public.calendar_appointment_professionals', 'DELETE')::text;`),
    );
    expect(linha).toBe("true|false|false");
  });
});

describe("booked_at — quando o horário atual foi fixado", () => {
  it("nasce preenchido; mexer na observação não o move; remarcar o recarimba", () => {
    const id = ultimaLinha(sql(marcar("Carimbo", "2027-06-25T13:00:00Z", "2027-06-25T13:30:00Z", [CARLA])));
    expect(gravado("Carimbo", "(booked_at is not null)::text")).toBe("true");

    sql(`update public.calendar_appointments set booked_at = '2000-01-01T00:00:00Z' where id = '${id}';`);
    sql(`update public.calendar_appointments set notes = 'só a observação' where id = '${id}';`);
    expect(gravado("Carimbo", "(booked_at = '2000-01-01T00:00:00Z')::text"), "observação moveu o carimbo").toBe("true");

    sql(`update public.calendar_appointments
            set starts_at = '2027-06-26T13:00:00Z', ends_at = '2027-06-26T13:30:00Z'
          where id = '${id}';`);
    expect(gravado("Carimbo", "(booked_at > '2000-01-01T00:00:00Z')::text"), "remarcar não recarimbou").toBe("true");
  });

  it("o backfill do baseline grava created_at SEM tocar em updated_at — a agenda não volta inteira ao Google", () => {
    // Sem `returning`: a etiqueta `INSERT 0 1` viria DEPOIS do id e `ultimaLinha`
    // a pegaria no lugar dele.
    sql(`insert into public.calendar_appointments
           (organization_id, title, starts_at, ends_at, owner_user_id, status, created_at)
         values ('${ORG_LEGADO}', 'Sem carimbo', '2027-07-01T13:00:00Z', '2027-07-01T13:30:00Z',
                 '${LEGADO_1}', 'confirmed', '2026-01-15T12:00:00Z');`);
    const id = ultimaLinha(
      sql(`select id from public.calendar_appointments
            where organization_id = '${ORG_LEGADO}' and title = 'Sem carimbo';`),
    );
    // Simula o clone antes da 0245: coluna nula. `google_synced_at` mexido no MESMO
    // UPDATE faz o carimbo do Google igualar `updated_at` — a linha parte "em dia".
    sql(`alter table public.calendar_appointments alter column booked_at drop not null;
         update public.calendar_appointments
            set booked_at = null, google_synced_at = '2030-01-01T00:00:00Z'
          where id = '${id}';`);
    const antes = ultimaLinha(
      sql(`select updated_at::text || '|' || needs_google_push::text from public.calendar_appointments where id = '${id}';`),
    );
    expect(antes.endsWith("|false"), "CONTROLE: a linha já partiu pendente de ida ao Google").toBe(true);

    sql(blocoDa0245NoBaseline());

    expect(
      ultimaLinha(sql(`select (booked_at = created_at)::text from public.calendar_appointments where id = '${id}';`)),
    ).toBe("true");
    expect(
      ultimaLinha(
        sql(`select updated_at::text || '|' || needs_google_push::text from public.calendar_appointments where id = '${id}';`),
      ),
      "o backfill moveu updated_at: needs_google_push mandaria o histórico inteiro de volta ao Google",
    ).toBe(antes);
    // E o trigger de updated_at voltou ligado, e a coluna voltou NOT NULL.
    expect(
      ultimaLinha(
        sql(`select t.tgenabled::text || '|' || a.attnotnull::text
               from pg_trigger t, pg_attribute a
              where t.tgrelid = 'public.calendar_appointments'::regclass
                and t.tgname = 'trg_calendar_appointments_updated_at'
                and a.attrelid = 'public.calendar_appointments'::regclass
                and a.attname = 'booked_at';`),
      ),
    ).toBe("O|true");
  });
});

/**
 * O apêndice da 0194 desligava `reminder_enabled` de TODO tipo, em TODO
 * `update.sh`. Com o cron de lembrete lendo a coluna (0245), isso apagava a
 * escolha do operador a cada atualização.
 */
describe("re-aplicar o baseline não desliga o lembrete que o operador ligou", () => {
  function blocoDa0194NoBaseline(): string {
    const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
    const rotulo = "-- ---- lembrete nasce desligado (migration 0194) ----";
    const inicio = baseline.indexOf(rotulo);
    const fim = baseline.indexOf("\n-- ---- ", inicio + rotulo.length);
    if (inicio < 0 || fim < 0) throw new Error("INSTRUMENTO: não achei o bloco da 0194 no baseline.sql");
    return baseline.slice(inicio, fim);
  }

  it("CONTROLE: o bloco existe e ainda põe o DEFAULT em false", () => {
    expect(blocoDa0194NoBaseline()).toMatch(/alter column reminder_enabled set default false/);
  });

  it("um tipo com lembrete LIGADO continua ligado depois do bloco", () => {
    sql(`update public.calendar_event_types set reminder_enabled = true where id = '${TIPO_UM}';`);
    sql(blocoDa0194NoBaseline());
    expect(
      ultimaLinha(sql(`select reminder_enabled::text from public.calendar_event_types where id = '${TIPO_UM}';`)),
    ).toBe("true");
  });

  it("CONTROLE: tipo novo continua nascendo desligado (o DEFAULT é o que ficou)", () => {
    sql(`insert into public.calendar_event_types (organization_id, name, slug, category, duration_minutes)
         values ('${ORG_A}', 'Nasce desligado', 'inv0245-nasce-desligado', 'consulta', 30)
         on conflict do nothing;`);
    expect(
      ultimaLinha(
        sql(`select reminder_enabled::text from public.calendar_event_types
              where organization_id = '${ORG_A}' and slug = 'inv0245-nasce-desligado';`),
      ),
    ).toBe("false");
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
