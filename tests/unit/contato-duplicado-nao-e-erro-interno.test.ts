/**
 * CRIAR UM CONTATO QUE JÁ EXISTE NÃO É "ERRO INTERNO".
 *
 * Medido em produção (2026-09-29): cadastrar pela tela um telefone que já era
 * de outro contato da organização — o caso mais comum, porque quem manda
 * mensagem vira contato sozinho — devolvia 500 `internal_error`, e a pessoa
 * não tinha o que fazer. O banco recusa com 23505 em `uniq_contacts_org_phone`;
 * a resposta certa é 409 dizendo qual dado repetiu e de quem ele é.
 */
import { describe, expect, it } from "vitest";

import { createContactHandler } from "@/app/api/v1/contacts/_handler";
import { ApiError } from "@/lib/api/types";

const ORG = "11111111-1111-4111-8111-111111111111";

function supabaseComDuplicado(erro: { code: string; message: string }) {
  const consultas: Array<Record<string, unknown>> = [];
  const builder = (tabela: string) => {
    const filtros: Record<string, unknown> = { tabela };
    const q = {
      insert: () => q,
      select: () => q,
      eq: (c: string, v: unknown) => ((filtros[c] = v), q),
      neq: () => q,
      is: () => q,
      limit: () => q,
      single: async () => ({ data: null, error: erro }),
      maybeSingle: async () => {
        consultas.push(filtros);
        return { data: { id: "existente-1", name: "Ana Souza", display_name: null }, error: null };
      },
    };
    return q;
  };
  return { cliente: { from: builder } as never, consultas };
}

describe("contato duplicado", () => {
  it("telefone repetido vira 409 com o nome de quem já tem o número", async () => {
    const { cliente, consultas } = supabaseComDuplicado({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uniq_contacts_org_phone"',
    });
    const err = await createContactHandler(
      cliente,
      { organization_id: ORG, actor: { type: "user", id: "u1" }, requestId: "r1" },
      { name: "Ana", phone_number: "+5511987654321", source: "manual" },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("contact_already_exists");
    expect(err.message).toContain("telefone");
    expect(err.message).toContain("Ana Souza");
    expect(err.details).toMatchObject({ existing_contact_id: "existente-1" });
    // A busca do dono é da MESMA organização (service role não filtra sozinho).
    expect(consultas[0]).toMatchObject({ organization_id: ORG, phone_number: "+5511987654321" });
  });

  it("outro erro do banco continua 500 — não se esconde falha real atrás de 'já existe'", async () => {
    const { cliente } = supabaseComDuplicado({ code: "42501", message: "permission denied" });
    const err = await createContactHandler(
      cliente,
      { organization_id: ORG, actor: { type: "user", id: "u1" }, requestId: "r1" },
      { name: "Ana", source: "manual" },
    ).catch((e) => e);
    expect(err.status).toBe(500);
  });
});
