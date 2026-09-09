import { describe, expect, it } from "vitest";

import { sessaoAtivaDaOrg } from "@/lib/channels/sessao-ativa";

/** Um admin client falso: o encadeamento .from().select().eq().eq() resolve {data}. */
function fakeAdmin(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.is = () => q; // `.is(archived_at, null)` do queryTolerantToMissingArchived
  q.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: rows, error: null });
  return { from: () => q } as never;
}

describe("sessaoAtivaDaOrg — provider-agnóstica (bug do avatar)", () => {
  it("NÃO devolve null quando a 1ª linha WORKING é Stevo (waha_session_name nulo)", async () => {
    // Era o bug: selecionava só waha_session_name; Stevo na frente devolvia null,
    // e TODO contato virava silhueta mesmo com um canal no ar.
    const rows = [
      { provider: "stevo", waha_session_name: null, stevo_instance_id: "inst-1" },
      { provider: "waha", waha_session_name: "sessao-waha" },
    ];
    const sessao = await sessaoAtivaDaOrg(fakeAdmin(rows), "org");
    expect(sessao).not.toBeNull();
    expect(sessao).toEqual({ sessionRef: "inst-1", provider: "stevo" });
  });

  it("resolve o ref do WAHA quando é o canal WORKING", async () => {
    const rows = [{ provider: "waha", waha_session_name: "sessao-waha" }];
    const sessao = await sessaoAtivaDaOrg(fakeAdmin(rows), "org");
    expect(sessao).toEqual({ sessionRef: "sessao-waha", provider: "waha" });
  });

  it("pula linha sem ref resolvível e devolve null quando nenhuma serve", async () => {
    const rows = [{ provider: "waha", waha_session_name: null }];
    const sessao = await sessaoAtivaDaOrg(fakeAdmin(rows), "org");
    expect(sessao).toBeNull();
  });

  it("org sem canal WORKING devolve null", async () => {
    const sessao = await sessaoAtivaDaOrg(fakeAdmin([]), "org");
    expect(sessao).toBeNull();
  });
});
