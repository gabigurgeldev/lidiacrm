import { describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * O que a migration 0220 promete, cobrado no banco que o CLONE recebe
 * (`supabase/baseline.sql` num Postgres descartável).
 *
 *  1. Membro da org A lê as mensagens agendadas da A, e NÃO as da B.
 *  2. Membro da A não desmarca (UPDATE) nem apaga as da B.
 *  3. `viewer` lê mas não marca: a escrita é `agent`+, a mesma régua da rota.
 *  4. O banco recusa telefone de aviso fora de E.164 e aviso pela metade.
 *  5. Anonimizar o contato apaga o texto e desmarca o que não saiu.
 */

const ORG_A = "0220aaaa-0000-4000-8000-000000000001";
const ORG_B = "0220bbbb-0000-4000-8000-000000000002";
const AGENTE_A = "0220aaaa-1111-4000-8000-000000000001";
const VIEWER_A = "0220aaaa-2222-4000-8000-000000000002";
const SESS_A = "0220aaaa-3333-4000-8000-000000000001";
const SESS_B = "0220bbbb-3333-4000-8000-000000000002";
const CT_A = "0220aaaa-4444-4000-8000-000000000001";
const CT_B = "0220bbbb-4444-4000-8000-000000000002";
const CONV_A = "0220aaaa-5555-4000-8000-000000000001";
const CONV_B = "0220bbbb-5555-4000-8000-000000000002";
const MSG_A = "0220aaaa-6666-4000-8000-000000000001";
const MSG_B = "0220bbbb-6666-4000-8000-000000000002";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values
      ('${AGENTE_A}', 'agendada-agente@invariant.test'),
      ('${VIEWER_A}', 'agendada-viewer@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'agendada-inv-a', 'Agendada Inv A', 'Agendada A'),
      ('${ORG_B}', 'agendada-inv-b', 'Agendada Inv B', 'Agendada B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENTE_A}', '${ORG_A}', 'agent', now()),
      ('${VIEWER_A}', '${ORG_A}', 'viewer', now())
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESS_A}', '${ORG_A}', 'agendada-inv-a', '\\x00'::bytea),
      ('${SESS_B}', '${ORG_B}', 'agendada-inv-b', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CT_A}', '${ORG_A}', 'Cliente A', '+5511900000220'),
      ('${CT_B}', '${ORG_B}', 'Cliente B', '+5511900000221')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id) values
      ('${CONV_A}', '${ORG_A}', '${CT_A}', '${SESS_A}'),
      ('${CONV_B}', '${ORG_B}', '${CT_B}', '${SESS_B}')
      on conflict (id) do nothing;
    insert into public.conversation_scheduled_messages
      (id, organization_id, conversation_id, contact_id, channel_session_id, body, scheduled_for, notify_phone, notify_body)
    values
      ('${MSG_A}', '${ORG_A}', '${CONV_A}', '${CT_A}', '${SESS_A}', 'Oi A, lembrete', now() + interval '1 day', '+5511988887777', 'Ligar para A'),
      ('${MSG_B}', '${ORG_B}', '${CONV_B}', '${CT_B}', '${SESS_B}', 'Oi B, lembrete', now() + interval '1 day', null, null)
      on conflict (id) do nothing;
  `);
}

describe("0220 · mensagem agendada chega ao clone, isolada por organização", () => {
  it("RLS ligada", () => {
    seed();
    expect(
      sql(
        `select relrowsecurity from pg_class where relname = 'conversation_scheduled_messages' and relkind = 'r'`,
      ),
    ).toBe("t");
  });

  it("membro da A lê as da A, e não as da B", () => {
    const q = (org: string) =>
      `select count(*) from public.conversation_scheduled_messages where organization_id = '${org}';`;
    expect(countAs(AGENTE_A, q(ORG_A))).toBe(1);
    expect(countAs(AGENTE_A, q(ORG_B))).toBe(0);
  });

  it("membro da A não desmarca nem apaga as da B", () => {
    expect(
      writeCountAs(
        AGENTE_A,
        `update public.conversation_scheduled_messages set status = 'cancelled' where id = '${MSG_B}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        AGENTE_A,
        `delete from public.conversation_scheduled_messages where id = '${MSG_B}'`,
      ),
    ).toBe(0);
    expect(
      sql(`select status from public.conversation_scheduled_messages where id = '${MSG_B}'`),
    ).toBe("scheduled");
  });

  it("agente da A desmarca a da A (controle positivo da escrita)", () => {
    expect(
      writeCountAs(
        AGENTE_A,
        `update public.conversation_scheduled_messages set status = 'scheduled' where id = '${MSG_A}'`,
      ),
    ).toBe(1);
  });

  it("viewer lê, mas não marca", () => {
    expect(
      countAs(
        VIEWER_A,
        `select count(*) from public.conversation_scheduled_messages where organization_id = '${ORG_A}';`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        VIEWER_A,
        `update public.conversation_scheduled_messages set status = 'cancelled' where id = '${MSG_A}'`,
      ),
    ).toBe(0);
  });

  it("banco recusa telefone de aviso fora de E.164 e aviso sem texto", () => {
    const inserir = (phone: string, body: string) =>
      sql(`
        insert into public.conversation_scheduled_messages
          (organization_id, conversation_id, contact_id, channel_session_id, body, scheduled_for, notify_phone, notify_body)
        values ('${ORG_A}', '${CONV_A}', '${CT_A}', '${SESS_A}', 'x', now(), ${phone}, ${body})
      `);
    expect(() => inserir(`'11988887777'`, `'aviso'`)).toThrow(/notify_check/);
    expect(() => inserir(`'+5511988887777'`, `null`)).toThrow(/notify_check/);
    // O lado oposto: CHECK só reprova FALSE, e `null ~ regex` é NULL.
    expect(() => inserir(`null`, `'aviso'`)).toThrow(/notify_check/);
  });

  it("anonimizar o contato apaga o texto e desmarca o que não saiu", () => {
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${CT_A}', gen_random_uuid())`);
    expect(
      sql(
        `select body || '|' || notify_body || '|' || status from public.conversation_scheduled_messages where id = '${MSG_A}'`,
      ),
    ).toBe("[anonimizado]|[anonimizado]|cancelled");
    // A B não foi tocada.
    expect(
      sql(`select body from public.conversation_scheduled_messages where id = '${MSG_B}'`),
    ).toBe("Oi B, lembrete");
  });
});
