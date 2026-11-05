import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * Migration 0253 — agente não toma conversa que não pode ver.
 *
 * A leitura sempre respeitou `visibility_mode` (fn_can_view_conversation, 0035).
 * A escrita de dono não: `fn_conversation_assign` é SECURITY DEFINER e só
 * conferia "agent+ da org". Com o id, um agente transferia para si ou assumia
 * a conversa de um colega que a RLS nem o deixava ver (reclamação real de
 * uma cliente, 04/11/2026: "ela pode pegar um contato").
 *
 * O teste fala com o banco como o PostgREST fala (role `authenticated` + JWT),
 * porque é por esse caminho que as rotas chamam a função. E mede os DOIS lados:
 * o que tem de ser barrado, e o que tem de continuar passando — sem o segundo,
 * uma função que recusasse tudo deixaria este arquivo verde.
 */

// Namespace exclusivo deste arquivo (0252aaaa…), uma org por modo de visibilidade.
const ORG = {
  own_and_unassigned: "0252aaaa-0000-4000-8000-000000000001",
  own: "0252aaaa-0000-4000-8000-000000000002",
  all: "0252aaaa-0000-4000-8000-000000000003",
} as const;
type Modo = keyof typeof ORG;

const SESSAO: Record<Modo, string> = {
  own_and_unassigned: "0252aaaa-2222-4000-8000-000000000001",
  own: "0252aaaa-2222-4000-8000-000000000002",
  all: "0252aaaa-2222-4000-8000-000000000003",
};

/** Conversas: `<modo>:<rótulo>` → id. Uma por caso, para a ordem dos testes não importar. */
const CONVERSAS: Array<{ modo: Modo; rotulo: string; dono: string | null }> = [
  { modo: "own_and_unassigned", rotulo: "de-B-claim", dono: GOV_AGENT_B },
  { modo: "own_and_unassigned", rotulo: "de-B-transfer", dono: GOV_AGENT_B },
  { modo: "own_and_unassigned", rotulo: "de-B-manager", dono: GOV_AGENT_B },
  { modo: "own_and_unassigned", rotulo: "sem-dono", dono: null },
  { modo: "own_and_unassigned", rotulo: "de-A-passa-para-B", dono: GOV_AGENT_A },
  { modo: "own", rotulo: "sem-dono", dono: null },
  { modo: "own", rotulo: "sem-dono-rodizio", dono: null },
  { modo: "all", rotulo: "de-B", dono: GOV_AGENT_B },
];

function idDe(modo: Modo, rotulo: string): string {
  const i = CONVERSAS.findIndex((c) => c.modo === modo && c.rotulo === rotulo);
  if (i < 0) throw new Error(`conversa desconhecida: ${modo}:${rotulo}`);
  return `0252aaaa-4444-4000-8000-${String(i + 1).padStart(12, "0")}`;
}

function contatoDe(modo: Modo, rotulo: string): string {
  return idDe(modo, rotulo).replace("-4444-", "-3333-");
}

interface Atribuicao {
  org: string;
  conversa: string;
  para: string | null;
  reason: string;
  esperado?: string | null;
  exigirEsperado?: boolean;
}

function chamada(a: Atribuicao): string {
  const para = a.para ? `'${a.para}'::uuid` : "null::uuid";
  const esperado = a.esperado ? `'${a.esperado}'::uuid` : "null::uuid";
  return `select count(*) from public.fn_conversation_assign(
    '${a.org}'::uuid, '${a.conversa}'::uuid, ${para}, '${a.reason}',
    ${esperado}, ${a.exigirEsperado ? "true" : "false"});`;
}

/**
 * Chama a função como `userId` (null = service role, sem `sub`, que é como o
 * worker de rodízio chama). Devolve o nº de linhas atribuídas, ou a mensagem
 * de erro do psql quando a função recusa.
 */
function atribuirComo(userId: string | null, a: Atribuicao): { linhas: number } | { erro: string } {
  const papel = userId ? "authenticated" : "service_role";
  const claims = userId ? `{"sub":"${userId}"}` : "{}";
  try {
    const out = sql(`
      set role ${papel};
      select set_config('request.jwt.claims', '${claims}', false);
      ${chamada(a)}
    `);
    return { linhas: Number(lastLine(out)) };
  } catch (err) {
    return { erro: (err as { stderr?: string }).stderr ?? String(err) };
  }
}

function donoAtual(conversa: string): string {
  return lastLine(
    sql(`select coalesce(assigned_to_user_id::text, 'ninguem') from public.conversations
           where id = '${conversa}';`),
  );
}

beforeAll(() => {
  seedGov();

  const orgs = (Object.keys(ORG) as Modo[])
    .map(
      (modo) => `
    insert into public.organizations (id, slug, legal_name, display_name, settings)
      values ('${ORG[modo]}', 'inv-0252-${modo.replace(/_/g, "-")}', 'Inv 0252 ${modo}', 'Inv 0252',
              jsonb_build_object('visibility_mode', '${modo}'))
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${GOV_AGENT_A}', '${ORG[modo]}', 'agent', now()),
             ('${GOV_AGENT_B}', '${ORG[modo]}', 'agent', now()),
             ('${GOV_MANAGER}', '${ORG[modo]}', 'manager', now())
      on conflict do nothing;
    do $inv$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO[modo]}', '${ORG[modo]}', 'inv-0252-${modo}', '\\x00'::bytea);
    exception when unique_violation then null; end $inv$;`,
    )
    .join("\n");

  const conversas = CONVERSAS.map(({ modo, rotulo, dono }) => {
    const id = idDe(modo, rotulo);
    const contato = contatoDe(modo, rotulo);
    const colunasDono = dono ? ", assigned_to_user_id, assigned_at" : "";
    const valoresDono = dono ? `, '${dono}', now()` : "";
    return `
    insert into public.contacts (id, organization_id, display_name)
      values ('${contato}', '${ORG[modo]}', 'Inv 0252 ${rotulo}') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status${colunasDono})
      values ('${id}', '${ORG[modo]}', '${contato}', '${SESSAO[modo]}', '${dono ? "claimed" : "open"}'${valoresDono})
      on conflict do nothing;`;
  }).join("\n");

  sql(`${orgs}\n${conversas}`);
});

describe("0253 — agente só mexe no dono da conversa que pode ver", () => {
  describe("modo own_and_unassigned (o padrão)", () => {
    const org = ORG.own_and_unassigned;

    it("agente A NÃO assume a conversa de B, nem com o 'takeover consciente' (expected = B)", () => {
      const conversa = idDe("own_and_unassigned", "de-B-claim");
      const r = atribuirComo(GOV_AGENT_A, {
        org,
        conversa,
        para: GOV_AGENT_A,
        reason: "claim",
        esperado: GOV_AGENT_B,
        exigirEsperado: true,
      });
      expect(r).toEqual({ erro: expect.stringContaining("conversation_not_visible") });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_B);
    });

    it("agente A NÃO transfere para si a conversa de B (transfer sem lock)", () => {
      const conversa = idDe("own_and_unassigned", "de-B-transfer");
      const r = atribuirComo(GOV_AGENT_A, {
        org,
        conversa,
        para: GOV_AGENT_A,
        reason: "transfer",
      });
      expect(r).toEqual({ erro: expect.stringContaining("conversation_not_visible") });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_B);
    });

    it("agente A assume uma conversa SEM dono (a fila continua dele neste modo)", () => {
      const conversa = idDe("own_and_unassigned", "sem-dono");
      expect(
        atribuirComo(GOV_AGENT_A, {
          org,
          conversa,
          para: GOV_AGENT_A,
          reason: "claim",
          exigirEsperado: true,
        }),
      ).toEqual({ linhas: 1 });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_A);
    });

    it("agente A transfere a PRÓPRIA conversa para B", () => {
      const conversa = idDe("own_and_unassigned", "de-A-passa-para-B");
      expect(
        atribuirComo(GOV_AGENT_A, { org, conversa, para: GOV_AGENT_B, reason: "transfer" }),
      ).toEqual({ linhas: 1 });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_B);
    });

    it("manager transfere a conversa de B para A (gerente redistribui)", () => {
      const conversa = idDe("own_and_unassigned", "de-B-manager");
      expect(
        atribuirComo(GOV_MANAGER, { org, conversa, para: GOV_AGENT_A, reason: "transfer" }),
      ).toEqual({ linhas: 1 });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_A);
    });
  });

  describe("modo own (só os seus)", () => {
    const org = ORG.own;

    it("agente A NÃO assume conversa sem dono, que ele não enxerga neste modo", () => {
      const conversa = idDe("own", "sem-dono");
      const r = atribuirComo(GOV_AGENT_A, {
        org,
        conversa,
        para: GOV_AGENT_A,
        reason: "claim",
        exigirEsperado: true,
      });
      expect(r).toEqual({ erro: expect.stringContaining("conversation_not_visible") });
      expect(donoAtual(conversa)).toBe("ninguem");
    });

    it("o rodízio (service role, sem auth.uid) continua distribuindo", () => {
      const conversa = idDe("own", "sem-dono-rodizio");
      expect(
        atribuirComo(null, {
          org,
          conversa,
          para: GOV_AGENT_B,
          reason: "routing",
          exigirEsperado: true,
        }),
      ).toEqual({ linhas: 1 });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_B);
    });
  });

  describe("modo all (todos veem tudo)", () => {
    it("nada muda: agente A assume a conversa de B com o lock otimista", () => {
      const conversa = idDe("all", "de-B");
      expect(
        atribuirComo(GOV_AGENT_A, {
          org: ORG.all,
          conversa,
          para: GOV_AGENT_A,
          reason: "claim",
          esperado: GOV_AGENT_B,
          exigirEsperado: true,
        }),
      ).toEqual({ linhas: 1 });
      expect(donoAtual(conversa)).toBe(GOV_AGENT_A);
    });
  });
});
