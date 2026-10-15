import { describe, expect, it } from "vitest";

import { __test_fitToBudget, getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

// fitToBudget é interno; exportar como __test_fitToBudget (ver Step 3).
describe("fitToBudget — mídia no contexto", () => {
  const base = { lead_id: "l1", contact: { name: "x", phone: null, email: null, tags: [], is_blocked: false }, conversation_id: "c1", last_human_decision: null };

  it("mídia com derivado: conteúdo presente + enquadrado (agente não nega a mídia)", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "audio", body: null, media_url: "u", media_storage_path: "p", media_mime: "audio/ogg", media_derived_text: "quero o tênis 42", sent_at: "2026-07-22T10:00:00Z" },
    ], 100000);
    const body = ctx.messages[0]!.body;
    expect(body).toContain("quero o tênis 42"); // conteúdo derivado presente
    expect(body).toContain("um áudio"); // enquadrado pelo tipo
    expect(body).toMatch(/não.*ver\/ouvir mídia/i); // instrução anti-reflexo de negação
    expect(ctx.messages[0]!.type).toBe("audio");
    expect(ctx.messages[0]!.media_storage_path).toBe("p");
  });

  it("mídia SEM derivado ainda cai no marcador [tipo]", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "image", body: null, media_url: "u", media_storage_path: "p", media_mime: "image/jpeg", media_derived_text: null, sent_at: "2026-07-22T10:00:00Z" },
    ], 100000);
    expect(ctx.messages[0]!.body).toBe("[image]");
  });

  it("texto puro inalterado", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "text", body: "oi", media_url: null, media_storage_path: null, media_mime: null, media_derived_text: null, sent_at: "2026-07-22T10:00:00Z" },
    ], 100000);
    expect(ctx.messages[0]!.body).toBe("oi");
  });

  it("mídia com LEGENDA e derivado — os dois coexistem, legenda não mascara a descrição", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "image", body: "quero esse", media_url: "u", media_storage_path: "p", media_mime: "image/jpeg", media_derived_text: "tênis vermelho tamanho 42", sent_at: "2026-07-22T10:00:00Z" },
    ], 100000);
    expect(ctx.messages[0]!.body).toContain("quero esse");
    expect(ctx.messages[0]!.body).toContain("tênis vermelho");
  });
});

/**
 * Caso real (floricultura, 2026-10-15): a atendente mandou fotos de buquês pelo
 * celular, a cliente citou uma e escreveu "Gostei desse", e o agente respondeu
 * "recebi várias fotos e não consegui ver qual você quis dizer" — duas vezes.
 */
describe("citação e mídia enviada por nós", () => {
  const base = { lead_id: "l1", contact: { name: "x", phone: null, email: null, tags: [], is_blocked: false }, conversation_id: "c1", last_human_decision: null };
  const FOTO_NOSSA = { id: "m-foto", direction: "outbound" as const, type: "image", body: "R$ 100", media_derived_text: "buquê de rosas vermelhas em papel kraft" };

  it("resposta que cita uma foto nossa leva QUAL foto — com descrição e legenda", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "text", body: "Gostei desse", media_url: null, media_storage_path: null, media_mime: null, media_derived_text: null, sent_at: "2026-10-15T11:44:00Z", reply_to_message_id: "m-foto" },
    ], 100000, new Map([["m-foto", FOTO_NOSSA]]));
    const body = ctx.messages[0]!.body;
    expect(body).toContain("Gostei desse");
    expect(body).toContain("rosas vermelhas em papel kraft");
    expect(body).toContain("R$ 100");
    expect(body).toMatch(/NOSSA/);
    expect(body).toMatch(/não pergunte qual/i);
  });

  it("controle: sem citação, o corpo segue intacto", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "text", body: "Gostei desse", media_url: null, media_storage_path: null, media_mime: null, media_derived_text: null, sent_at: "2026-10-15T11:44:00Z", reply_to_message_id: null },
    ], 100000, new Map([["m-foto", FOTO_NOSSA]]));
    expect(ctx.messages[0]!.body).toBe("Gostei desse");
  });

  it("citação cuja original não foi achada não inventa nada", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "inbound", type: "text", body: "Gostei desse", media_url: null, media_storage_path: null, media_mime: null, media_derived_text: null, sent_at: "2026-10-15T11:44:00Z", reply_to_message_id: "sumiu" },
    ], 100000, new Map());
    expect(ctx.messages[0]!.body).toBe("Gostei desse");
  });

  it("foto que NÓS mandamos não é rotulada como mídia do cliente", () => {
    const ctx = __test_fitToBudget(base, [
      { direction: "outbound", type: "image", body: "R$ 280", media_url: "u", media_storage_path: "p", media_mime: "image/jpeg", media_derived_text: "buquê de lírios brancos", sent_at: "2026-10-15T11:40:00Z" },
    ], 100000);
    const body = ctx.messages[0]!.body;
    expect(body).not.toMatch(/Mídia do cliente/);
    expect(body).toMatch(/enviada por nós/);
    expect(body).toContain("lírios brancos");
    expect(body).toContain("R$ 280");
  });

  it("a original é lida pelo id, na MESMA organização, mesmo fora da janela do histórico", async () => {
    const consultas: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      async query(sql: string, params: unknown[]) {
        consultas.push({ sql, params });
        if (/from contacts/.test(sql)) {
          return { rows: [{ name: "Ana", display_name: null, email: null, phone_number: null, tags: [], is_blocked: false, source: null, consent: null, is_anonymized: false }] };
        }
        if (/from crm_lead_activities/.test(sql)) return { rows: [] };
        if (/id = any/.test(sql)) return { rows: [FOTO_NOSSA] };
        if (/from messages/.test(sql)) {
          return { rows: [{ direction: "inbound", type: "text", body: "Gostei desse", media_url: null, media_storage_path: null, media_mime: null, media_derived_text: null, sent_at: "2026-10-15T11:44:00Z", reply_to_message_id: "m-foto" }] };
        }
        return { rows: [] };
      },
    };

    const r = await getLeadContext(db as never, {} as never, { tenantId: "org-1", leadId: "contato-1", conversationId: "c1" }, { historyLimit: 20, maxTokens: 100000 });

    expect(r.ok).toBe(true);
    const leitura = consultas.find((c) => /id = any/.test(c.sql))!;
    expect(leitura.sql).toMatch(/organization_id = \$1/);
    expect(leitura.params).toEqual(["org-1", ["m-foto"]]);
    expect(r.ok && r.context.messages[0]!.body).toContain("rosas vermelhas");
  });
});
