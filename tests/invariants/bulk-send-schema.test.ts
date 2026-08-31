import { describe, expect, it } from "vitest";

import { columnExists, indexExists, sql, tableExists } from "./gov-helpers";

/**
 * DISPARO EM MASSA — OS CHECKS FAZEM O QUE DIZEM.
 *
 * Não é um teste de "as colunas existem": é um teste de que o SCHEMA RECUSA os
 * estados que a prosa promete recusar. A diferença importa — uma constraint
 * escrita e nunca exercitada é documentação que o banco por acaso guarda.
 *
 * Cada caso aqui corresponde a um estado que, se entrasse, teria um sintoma
 * mudo em produção. Estão nomeados por esse sintoma, não pela constraint.
 */

/** Executa um DML como superusuário e diz se o BANCO recusou. */
function recusado(dml: string): boolean {
  try {
    sql(`${dml};`);
    return false;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    // `check constraint` ou `unique constraint` — os dois são recusa do schema.
    if (/violates (check|unique) constraint/i.test(stderr)) return true;
    throw err;
  }
}

const ORG = "eeeeeeee-0000-4000-8000-000000000001";
const SESS = "eeeeeeee-2222-4000-8000-000000000001";
const CONTATO = "eeeeeeee-3333-4000-8000-000000000001";
const DISPARO = "eeeeeeee-4444-4000-8000-000000000001";

function semear(): void {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'disparo-schema', 'Disparo Schema', 'Disparo Schema')
      on conflict (id) do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESS}', '${ORG}', 'disparo-schema', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO}', '${ORG}', 'Schema Probe', '+5500900000099')
      on conflict (id) do nothing;
    insert into public.bulk_sends
      (id, organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
      values ('${DISPARO}', '${ORG}', 'Schema', 'draft', '${SESS}', 'waha', 'freeform', 'ola', 5000)
      on conflict (id) do nothing;
  `);
}

describe("as tabelas e as colunas do disparo", () => {
  it("as duas tabelas existem", () => {
    expect(tableExists("bulk_sends")).toBe(true);
    expect(tableExists("bulk_send_recipients")).toBe(true);
  });

  it("o disparo guarda relógio, lease e o motivo da pausa", () => {
    // `next_send_at` é o relógio do produto, `claimed_until` o lease do motor.
    // Colapsá-los faria um tique lento parecer campanha adiada.
    for (const c of ["next_send_at", "claimed_until", "pause_reason", "pause_detail", "provider"]) {
      expect(columnExists("bulk_sends", c), `bulk_sends.${c}`).toBe(true);
    }
  });

  it("o destinatário guarda motivo de pulo, erro e a mensagem que saiu", () => {
    for (const c of ["skip_reason", "error", "message_id", "attempts", "sent_at"]) {
      expect(columnExists("bulk_send_recipients", c), `bulk_send_recipients.${c}`).toBe(true);
    }
  });

  it("os índices que o motor e a tela usam existem", () => {
    expect(indexExists("uniq_bulk_send_recipient")).toBe(true);
    expect(indexExists("idx_bulk_sends_due")).toBe(true);
    expect(indexExists("idx_bulk_sends_por_numero")).toBe(true);
    expect(indexExists("idx_bulk_send_recipients_fila")).toBe(true);
  });

  it("RLS está LIGADA nas duas — policy sem enable não fecha nada", () => {
    const ligadas = sql(`
      select coalesce(string_agg(relname, ',' order by relname), '')
        from pg_class
       where relname in ('bulk_sends','bulk_send_recipients')
         and relrowsecurity;
    `);
    expect(ligadas).toBe("bulk_send_recipients,bulk_sends");
  });
});

describe("campanha impossível não nasce", () => {
  it("modo template SEM modelo é recusado", () => {
    // Sintoma se passasse: o canal oficial receberia um envio de template com
    // nome vazio e devolveria 400 cru, 500 vezes.
    semear();
    expect(
      recusado(`insert into public.bulk_sends
        (organization_id, name, status, channel_session_id, provider, mode, interval_ms)
        values ('${ORG}', 'sem modelo', 'draft', '${SESS}', 'meta_cloud', 'template', 5000)`),
    ).toBe(true);
  });

  it("modo livre SEM corpo é recusado", () => {
    // Sintoma se passasse: string vazia enviada para a lista inteira.
    semear();
    expect(
      recusado(`insert into public.bulk_sends
        (organization_id, name, status, channel_session_id, provider, mode, interval_ms)
        values ('${ORG}', 'sem corpo', 'draft', '${SESS}', 'waha', 'freeform', 5000)`),
    ).toBe(true);
  });

  it("corpo só com espaços conta como vazio", () => {
    semear();
    expect(
      recusado(`insert into public.bulk_sends
        (organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
        values ('${ORG}', 'so espaco', 'draft', '${SESS}', 'waha', 'freeform', '   ', 5000)`),
    ).toBe(true);
  });

  it("intervalo fora da régua do produto é recusado nos dois extremos", () => {
    semear();
    // Zero viraria rajada na leitura da tela (o motor aplicaria o piso, mas a
    // tela prometeria outra coisa); acima do teto é erro de digitação.
    expect(
      recusado(`insert into public.bulk_sends
        (organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
        values ('${ORG}', 'rajada', 'draft', '${SESS}', 'waha', 'freeform', 'oi', 0)`),
    ).toBe(true);
    expect(
      recusado(`insert into public.bulk_sends
        (organization_id, name, status, channel_session_id, provider, mode, body, interval_ms)
        values ('${ORG}', 'lento demais', 'draft', '${SESS}', 'waha', 'freeform', 'oi', 99999999)`),
    ).toBe(true);
  });
});

describe("nenhum destinatário fica sem explicação", () => {
  it("pulado SEM motivo é recusado", () => {
    // É o silêncio que a feature existe para não ter: a tela mostraria uma
    // linha "fora da lista" sem dizer por quê, e o invariante 4 (nenhuma demanda
    // sem próximo passo) morreria numa linha em branco.
    semear();
    expect(
      recusado(`insert into public.bulk_send_recipients
        (organization_id, bulk_send_id, contact_id, status)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'skipped')`),
    ).toBe(true);
  });

  it("motivo de pulo fora do vocabulário é recusado", () => {
    // O vocabulário fechado é o que garante que `fraseDoPulo` sempre tenha
    // tradução — e `tests/unit/bulk-send-frases.test.ts` varre este mesmo CHECK.
    semear();
    expect(
      recusado(`insert into public.bulk_send_recipients
        (organization_id, bulk_send_id, contact_id, status, skip_reason)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'skipped', 'motivo_inventado')`),
    ).toBe(true);
  });

  it("NÃO-pulado COM motivo também é recusado — a equivalência vale nos dois sentidos", () => {
    // Uma linha que voltou para a fila carregando motivo antigo mentiria na
    // próxima leitura da tela.
    semear();
    expect(
      recusado(`insert into public.bulk_send_recipients
        (organization_id, bulk_send_id, contact_id, status, skip_reason)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'pending', 'no_phone')`),
    ).toBe(true);
  });

  it("`sending` é um estado aceito — é ele que torna a retomada segura", () => {
    semear();
    sql(`delete from public.bulk_send_recipients where bulk_send_id = '${DISPARO}';`);
    expect(
      recusado(`insert into public.bulk_send_recipients
        (organization_id, bulk_send_id, contact_id, status)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'sending')`),
    ).toBe(false);
  });
});

describe("a mesma pessoa não recebe duas vezes na mesma campanha", () => {
  it("o unique (bulk_send_id, contact_id) recusa a segunda linha", () => {
    // É a última linha de defesa contra duplo clique e corrida no motor — a
    // dedupe por variante de telefone roda antes, em TypeScript.
    semear();
    sql(`
      delete from public.bulk_send_recipients where bulk_send_id = '${DISPARO}';
      insert into public.bulk_send_recipients (organization_id, bulk_send_id, contact_id, status)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'pending');
    `);
    expect(
      recusado(`insert into public.bulk_send_recipients
        (organization_id, bulk_send_id, contact_id, status)
        values ('${ORG}', '${DISPARO}', '${CONTATO}', 'pending')`),
    ).toBe(true);
  });
});

describe("a Central de avisos aceita o kind do disparo", () => {
  it("`disparo_travado` passa pelo CHECK de agent_inbox_items", () => {
    // Sem isto o INSERT do aviso violaria a constraint, o `catch`
    // fire-and-forget engoliria, e o operador NUNCA veria a campanha travada —
    // exatamente o modo de falha mudo que a issue #159 documentou.
    const def = sql(`
      select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'agent_inbox_items_kind_check';
    `);
    expect(def).toContain("disparo_travado");
  });
});
