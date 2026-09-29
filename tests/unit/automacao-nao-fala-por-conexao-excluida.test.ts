/**
 * AUTOMAÇÃO NÃO FALA POR CONEXÃO EXCLUÍDA.
 *
 * Medido em produção (2026-09-29): o bloco "Mandar mensagem para o cliente" de
 * um fluxo guardava uma conexão excluída em 14/09. Cada execução abria uma
 * conversa nova naquele número morto e o envio falhava com `channel_archived` —
 * a Caixa de entrada mostrava o mesmo cliente em várias linhas.
 */
import { describe, expect, it } from "vitest";

import { conexaoParaOContato } from "@/lib/automation/start-conversation";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";

interface Sessao {
  id: string;
  organization_id: string;
  status: string;
  archived_at: string | null;
  created_at: string;
}
interface Conversa {
  organization_id: string;
  contact_id: string;
  channel_session_id: string;
  is_group: boolean;
  last_inbound_at: string | null;
}

function banco(sessoes: Sessao[], conversas: Conversa[] = []) {
  const from = (tabela: string) => {
    let linhas: Array<Record<string, unknown>> =
      (tabela === "channel_sessions" ? [...sessoes] : [...conversas]) as unknown as Array<Record<string, unknown>>;
    let ordem: string | null = null;
    let limite = Infinity;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
      is: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
      not: (c: string) => ((linhas = linhas.filter((l) => l[c] !== null)), q),
      in: (c: string, vs: unknown[]) => ((linhas = linhas.filter((l) => vs.includes(l[c]))), q),
      order: (c: string) => ((ordem = c), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (ok: (r: { data: unknown; error: null }) => unknown) => {
        let r = linhas;
        if (ordem !== null) {
          const c = ordem;
          r = [...r].sort((a, b) => String(b[c]).localeCompare(String(a[c])));
        }
        return Promise.resolve({ data: r.slice(0, limite), error: null }).then(ok);
      },
    };
    return q;
  };
  return { from } as never;
}

const sessao = (id: string, extra: Partial<Sessao> = {}): Sessao => ({
  id,
  organization_id: ORG,
  status: "WORKING",
  archived_at: null,
  created_at: "2026-09-01T00:00:00Z",
  ...extra,
});

describe("conexaoParaOContato", () => {
  it("conexão escolhida e viva: é ela", async () => {
    const r = await conexaoParaOContato(banco([sessao("viva")]), ORG, CONTATO, "viva");
    expect(r).toEqual({ kind: "conexao", id: "viva" });
  });

  it("conexão escolhida EXCLUÍDA: responde pelo número em que o cliente escreveu", async () => {
    const r = await conexaoParaOContato(
      banco(
        [
          sessao("morta", { archived_at: "2026-09-14T12:00:00Z", status: "STOPPED" }),
          sessao("primeira", { created_at: "2026-08-01T00:00:00Z" }),
          sessao("do-cliente"),
        ],
        [
          {
            organization_id: ORG,
            contact_id: CONTATO,
            channel_session_id: "do-cliente",
            is_group: false,
            last_inbound_at: "2026-09-29T18:20:00Z",
          },
        ],
      ),
      ORG,
      CONTATO,
      "morta",
    );
    expect(r).toEqual({ kind: "conexao", id: "do-cliente" });
  });

  it("a conversa mais recente numa conexão excluída não conta", async () => {
    const r = await conexaoParaOContato(
      banco(
        [sessao("morta", { archived_at: "2026-09-14T12:00:00Z" }), sessao("viva")],
        [
          {
            organization_id: ORG,
            contact_id: CONTATO,
            channel_session_id: "morta",
            is_group: false,
            last_inbound_at: "2026-09-29T18:25:00Z",
          },
          {
            organization_id: ORG,
            contact_id: CONTATO,
            channel_session_id: "viva",
            is_group: false,
            last_inbound_at: "2026-09-28T10:00:00Z",
          },
        ],
      ),
      ORG,
      CONTATO,
      null,
    );
    expect(r).toEqual({ kind: "conexao", id: "viva" });
  });

  it("sem conversa do cliente: primeira conexão viva da organização", async () => {
    const r = await conexaoParaOContato(
      banco([
        sessao("morta", { archived_at: "2026-09-14T12:00:00Z" }),
        sessao("viva"),
      ]),
      ORG,
      null,
      "morta",
    );
    expect(r).toEqual({ kind: "conexao", id: "viva" });
  });

  it("conexão de OUTRA organização é recusa, nunca queda para outra", async () => {
    const r = await conexaoParaOContato(
      banco([sessao("alheia", { organization_id: "outra" }), sessao("viva")]),
      ORG,
      CONTATO,
      "alheia",
    );
    expect(r).toEqual({ kind: "recusa", motivo: "conexao_nao_encontrada" });
  });
});
