import { beforeAll, describe, expect, it } from "vitest";

import { sql, countAs } from "./gov-helpers";

/**
 * BUSCA GLOBAL (⌘K) — ISOLAMENTO ENTRE DUAS ORGANIZAÇÕES.
 *
 * ═══ Por que a busca merece invariante próprio ═══
 *
 * Ela é a única consulta do produto que atravessa TRÊS tabelas tenant-aware de
 * uma vez (`contacts`, `conversations`, `crm_leads`) a partir de um texto livre
 * digitado por quem quer que esteja logado. Um erro de recorte aqui não devolve
 * uma linha a mais numa tela específica: devolve a base de clientes de um
 * inquilino dentro da caixa de busca de outro, com o nome dele em destaque.
 *
 * E a consulta de conversas usa `!inner` sobre `contacts` — um join. Join é
 * exatamente onde "a policy está na tabela certa" deixa de bastar: se a RLS de
 * `contacts` fosse permissiva, a conversa da org A apareceria filtrada pelo
 * nome de um contato da org B.
 *
 * ═══ O que se mede ═══
 *
 *   1. As três consultas do handler, rodadas COM O TERMO QUE CASA NAS DUAS
 *      organizações, devolvem só as linhas da organização de quem pergunta.
 *   2. O caminho oblíquo: filtrar por `organization_id` ALHEIO explicitamente —
 *      é o que uma rota faria se lesse o id do corpo da requisição em vez do
 *      cookie. A RLS tem de zerar mesmo assim.
 *   3. O join de conversas não é porta lateral: buscar pelo nome do contato da
 *      outra organização não traz conversa nenhuma.
 *
 * ⚠️ O QUE ESTE ARQUIVO NÃO PROVA: que a rota `app/api/v1/search/route.ts`
 * resolva a organização ativa corretamente. Ele mede a camada de baixo — se a
 * RLS segura mesmo que a de cima erre. A de cima tem o filtro explícito de
 * `organization_id` e o caso "sem organização ativa devolve vazio", e o motivo
 * de existirem as duas está no cabeçalho do handler.
 *
 * Sem PII: nomes sintéticos, telefone de faixa reservada.
 */

const ORG_A = "bbbbbbbb-0000-4000-8000-00000000000a";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USER_A = "bbbbbbbb-1111-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-1111-4000-8000-00000000000b";
const SESS_A = "bbbbbbbb-2222-4000-8000-00000000000a";
const SESS_B = "bbbbbbbb-2222-4000-8000-00000000000b";
const CONTATO_A = "bbbbbbbb-3333-4000-8000-00000000000a";
const CONTATO_B = "bbbbbbbb-3333-4000-8000-00000000000b";
const CONVERSA_A = "bbbbbbbb-4444-4000-8000-00000000000a";
const CONVERSA_B = "bbbbbbbb-4444-4000-8000-00000000000b";
const FUNIL_A = "bbbbbbbb-5555-4000-8000-00000000000a";
const FUNIL_B = "bbbbbbbb-5555-4000-8000-00000000000b";
const ETAPA_A = "bbbbbbbb-6666-4000-8000-00000000000a";
const ETAPA_B = "bbbbbbbb-6666-4000-8000-00000000000b";
const LEAD_A = "bbbbbbbb-7777-4000-8000-00000000000a";
const LEAD_B = "bbbbbbbb-7777-4000-8000-00000000000b";

/**
 * ⚠️ O TERMO É O MESMO NAS DUAS ORGANIZAÇÕES, e isso é o desenho do teste.
 *
 * Se cada uma tivesse um nome próprio, o "não vazou" poderia ser só o `ilike`
 * não casando — e o invariante ficaria verde sem a RLS fazer nada. Com o mesmo
 * termo dos dois lados, a única coisa que separa as linhas é o recorte por
 * organização, que é justamente o que se quer medir.
 */
const TERMO = "Zoraide";

function semear(
  org: string,
  user: string,
  sess: string,
  contato: string,
  conversa: string,
  funil: string,
  etapa: string,
  lead: string,
  tag: string,
): string {
  return `
    insert into auth.users (id, email) values ('${user}', 'busca-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'busca-inv-${tag}', 'Busca Invariant ${tag}', 'Busca ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${user}', '${org}', 'manager', now())
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', 'busca-inv-${tag}', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${contato}', '${org}', '${TERMO} da Silva ${tag}', '+5500900001${tag === "a" ? "01" : "02"}')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, channel, status)
      values ('${conversa}', '${org}', '${contato}', '${sess}', 'whatsapp', 'open')
      on conflict (id) do nothing;
    -- ATENCAO: slug e NOT NULL nas duas tabelas abaixo, e tem CHECK de formato.
    -- Omiti-lo faz o seed falhar no CI com um erro que parece de RLS e e de
    -- schema. (Sem crase e sem acento: isto vive dentro de um template literal.)
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${funil}', '${org}', 'Funil ${tag}', 'busca-inv-${tag}')
      on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${etapa}', '${org}', '${funil}', 'Proposta', 'proposta', 1)
      on conflict (id) do nothing;
    insert into public.crm_leads
      (id, organization_id, pipeline_id, stage_id, title, source, position_in_stage)
      values ('${lead}', '${org}', '${funil}', '${etapa}', '${TERMO} — plano anual', 'manual', 1000)
      on conflict (id) do nothing;
  `;
}

beforeAll(() => {
  sql(
    semear(ORG_A, USER_A, SESS_A, CONTATO_A, CONVERSA_A, FUNIL_A, ETAPA_A, LEAD_A, "a") +
      semear(ORG_B, USER_B, SESS_B, CONTATO_B, CONVERSA_B, FUNIL_B, ETAPA_B, LEAD_B, "b"),
  );
});

/** As três consultas do handler, em SQL — o mesmo recorte, sem o PostgREST no meio. */
const CONTATOS = `
  select count(*) from public.contacts
  where display_name ilike '%${TERMO}%' or name ilike '%${TERMO}%'`;
const CONVERSAS = `
  select count(*) from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where ct.display_name ilike '%${TERMO}%' or ct.name ilike '%${TERMO}%'`;
const LEADS = `
  select count(*) from public.crm_leads
  where title ilike '%${TERMO}%' or description ilike '%${TERMO}%'`;

describe("controle: o cenário existe antes de qualquer conclusão", () => {
  /**
   * Sem isto, um seed que falhou renderia zero em TODA consulta — e o teste de
   * vazamento ficaria verde por não haver dado nenhum para vazar. É o modo de
   * falha número um de um invariante de isolamento.
   */
  it("cada organização tem o próprio contato, a própria conversa e o próprio lead", () => {
    for (const [user, quem] of [
      [USER_A, "A"],
      [USER_B, "B"],
    ] as const) {
      expect(countAs(user, `${CONTATOS};`), `contato da org ${quem}`).toBe(1);
      expect(countAs(user, `${CONVERSAS};`), `conversa da org ${quem}`).toBe(1);
      expect(countAs(user, `${LEADS};`), `lead da org ${quem}`).toBe(1);
    }
  });

  it("e o termo casaria nas DUAS se a RLS não existisse", () => {
    // A prova de que o cenário é adversarial: as duas organizações têm linha
    // que o `ilike` acha. O que as separa é só o recorte por organização.
    expect(
      countAs(
        USER_A,
        `select count(*) from public.contacts where display_name ilike '%${TERMO}%';`,
      ) +
        countAs(
          USER_B,
          `select count(*) from public.contacts where display_name ilike '%${TERMO}%';`,
        ),
    ).toBe(2);
  });
});

describe("a busca da org A nunca alcança a org B", () => {
  it("contatos: o termo casa nas duas, e cada uma vê só o seu", () => {
    expect(countAs(USER_A, `${CONTATOS} and organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_B, `${CONTATOS} and organization_id = '${ORG_A}';`)).toBe(0);
  });

  /**
   * O join é o ponto frágil desta feature: o filtro da busca de conversas mora
   * no CONTATO embutido (`contacts!inner`), não na conversa. Se a RLS de
   * `contacts` afrouxasse, a conversa de uma organização passaria a ser
   * encontrável pelo nome do contato de outra.
   */
  it("conversas: nem pelo nome do contato alheio", () => {
    expect(countAs(USER_A, `${CONVERSAS} and c.organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_A, `${CONVERSAS} and ct.organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("leads: o título casa nas duas, e cada uma vê só o seu", () => {
    expect(countAs(USER_A, `${LEADS} and organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_B, `${LEADS} and organization_id = '${ORG_A}';`)).toBe(0);
  });

  /**
   * O caminho oblíquo: pedir a linha pelo ID, sem passar por organização. É
   * como um `href` copiado da tela de outra pessoa chegaria — e é o teste de
   * que a RLS responde à LINHA, não ao formato da consulta.
   */
  it("nem pelo id direto, que é como um link colado chegaria", () => {
    expect(countAs(USER_A, `select count(*) from public.contacts where id = '${CONTATO_B}';`)).toBe(
      0,
    );
    expect(
      countAs(USER_A, `select count(*) from public.conversations where id = '${CONVERSA_B}';`),
    ).toBe(0);
    expect(countAs(USER_A, `select count(*) from public.crm_leads where id = '${LEAD_B}';`)).toBe(0);
  });
});
