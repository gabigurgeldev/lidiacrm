import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FOTO PEDIDA AO ABRIR A CONVERSA — e as três travas que impedem isso de virar
 * uma enxurrada de chamadas ao WhatsApp.
 *
 * ## Por que a rota existe
 *
 * O cron varre 25 contatos a cada 10 minutos. Numa base de mil, o contato que a
 * pessoa acabou de abrir pode estar a muitas rodadas de distância — ela olha
 * para a silhueta e conclui que o produto não mostra foto.
 *
 * ## Por que ela é perigosa, e o que este arquivo guarda
 *
 * Cada busca é uma chamada ao canal. O inbox reabre a MESMA conversa dezenas de
 * vezes por dia, e uma rota sem guarda transformaria isso em dezenas de
 * chamadas por contato por dia — o caminho mais curto para um 429 do WhatsApp,
 * que não derruba só o avatar: derruba o ENVIO junto.
 *
 * Por isso os casos abaixo medem, acima de tudo, quando a rota **não** busca.
 */

const CONTATO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let linhaDoContato: Record<string, unknown> | null = null;
const sincronizou: string[] = [];

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "user-1" }),
  resolveActiveOrg: async () => ({ orgId: ORG }),
}));

vi.mock("@/lib/contacts/avatar-do-contato", () => ({
  sincronizarAvatar: async (_admin: unknown, contato: { id: string }) => {
    sincronizou.push(contato.id);
    return "atualizado";
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "maybeSingle") return async () => ({ data: linhaDoContato, error: null });
            return () => proxy;
          },
        },
      );
      return proxy;
    },
  }),
}));

import { POST } from "@/app/api/v1/contacts/[id]/avatar/route";

function chamar(): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/contacts/${CONTATO}/avatar`, {
      method: "POST",
    }) as never,
    { params: Promise.resolve({ id: CONTATO }) },
  );
}

beforeEach(() => {
  sincronizou.length = 0;
  linhaDoContato = {
    id: CONTATO,
    organization_id: ORG,
    wa_identity: "phone:+5511999990000",
    avatar_updated_at: null,
    is_anonymized: false,
  };
});

describe("POST /contacts/{id}/avatar", () => {
  it("busca quando o contato NUNCA foi tentado", async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(sincronizou).toEqual([CONTATO]);
  });

  it("NÃO busca de novo quando já houve uma tentativa", async () => {
    // A trava que separa "uma chamada por contato" de "uma chamada por abertura
    // de conversa". `avatar_updated_at` é carimbado mesmo quando não havia foto
    // — é exatamente para que o "sem foto" também conte como tentativa.
    linhaDoContato = { ...linhaDoContato!, avatar_updated_at: "2026-08-30T12:00:00Z" };

    const r = await chamar();
    expect(r.status).toBe(200);
    expect(sincronizou, "abrir a conversa de novo não pode custar outra chamada").toEqual([]);
  });

  it("NUNCA busca a foto de um contato anonimizado", async () => {
    // A função de sincronizar já recusa a GRAVAÇÃO (a corrida do cron), mas nem
    // começar é melhor: baixar o rosto de quem pediu remoção para depois recusar
    // o ponteiro ainda é baixá-lo.
    linhaDoContato = { ...linhaDoContato!, is_anonymized: true };

    await chamar();
    expect(sincronizou).toEqual([]);
  });

  it("contato de outra organização não existe para esta sessão", async () => {
    // Service role bypassa RLS; o filtro por organização é manual e vem do
    // cookie. Sem linha, 404 — nunca uma busca.
    linhaDoContato = null;

    const r = await chamar();
    expect(r.status).toBe(404);
    expect(sincronizou).toEqual([]);
  });
});
