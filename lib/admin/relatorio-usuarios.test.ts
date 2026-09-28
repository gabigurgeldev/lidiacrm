import { describe, expect, it } from "vitest";

import type { UsuarioDoDiretorio } from "./diretorio-auth";
import {
  celulaCsv,
  linhasDeExport,
  montarRelatorio,
  paraCsv,
  type VinculoParaRelatorio,
} from "./relatorio-usuarios";

const AGORA = new Date("2026-09-28T12:00:00Z");
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function u(id: string, over: Partial<UsuarioDoDiretorio> = {}): UsuarioDoDiretorio {
  return {
    id,
    email: `${id}@exemplo.com`,
    full_name: null,
    phone: null,
    last_sign_in_at: "2026-09-27T10:00:00Z",
    created_at: "2026-09-01T10:00:00Z",
    email_confirmed_at: "2026-09-01T10:00:00Z",
    banned_until: null,
    tem_mfa: false,
    ...over,
  };
}

function v(user_id: string, organization_id: string, role: string, revoked_at: string | null = null): VinculoParaRelatorio {
  return { user_id, organization_id, organization_name: organization_id === ORG_A ? "Alfa" : "Beta", role, revoked_at };
}

describe("montarRelatorio", () => {
  const usuarios = [
    u("ativo", { tem_mfa: true }),
    u("velho", { last_sign_in_at: "2026-06-01T00:00:00Z" }),
    u("nunca", { last_sign_in_at: null, email_confirmed_at: null, created_at: "2026-09-28T08:00:00Z" }),
    u("suspenso", { banned_until: "2126-01-01T00:00:00Z" }),
    u("solto"),
  ];
  const vinculos = [
    v("ativo", ORG_A, "admin"),
    v("ativo", ORG_B, "agent"),
    v("velho", ORG_A, "agent"),
    v("nunca", ORG_A, "viewer"),
    v("suspenso", ORG_B, "manager"),
    v("solto", ORG_A, "agent", "2026-09-01T00:00:00Z"), // revogado
  ];
  const r = montarRelatorio(usuarios, vinculos, 7, AGORA);

  it("conta totais por estado", () => {
    expect(r.totais).toMatchObject({
      usuarios: 5,
      suspensos: 1,
      pendentes: 1,
      sem_mfa: 4,
      email_nao_confirmado: 1,
      sem_organizacao: 1, // "solto" só tem vínculo revogado
    });
    // Ativos: ativo e solto (login ontem). Suspenso não conta em nenhum dos dois.
    expect(r.totais.ativos).toBe(2);
    expect(r.totais.inativos).toBe(2);
  });

  it("papel conta só vínculos ATIVOS, e pessoa em duas orgs conta duas vezes", () => {
    expect(r.por_papel).toEqual({ viewer: 1, agent: 2, manager: 1, admin: 1 });
  });

  it("organizações ordenadas por pessoas distintas", () => {
    expect(r.por_organizacao[0]).toMatchObject({ organization_id: ORG_A, usuarios: 3 });
    expect(r.por_organizacao[1]).toMatchObject({ organization_id: ORG_B, usuarios: 2 });
  });

  it("série tem um ponto por dia, com zero explícito, terminando hoje", () => {
    expect(r.serie).toHaveLength(7);
    expect(r.serie.at(-1)?.dia).toBe("2026-09-28");
    expect(r.serie.at(-1)?.cadastros).toBe(1);
    expect(r.serie.at(-2)).toMatchObject({ dia: "2026-09-27", acessos: 3 });
    expect(r.serie[0]).toMatchObject({ cadastros: 0, acessos: 0 });
  });

  it("inativos: quem nunca entrou vem primeiro", () => {
    expect(r.inativos.map((i) => i.id)).toEqual(["nunca", "velho"]);
  });
});

describe("linhasDeExport", () => {
  const usuarios = [u("a"), u("b", { banned_until: "2126-01-01T00:00:00Z" }), u("c")];
  const vinculos = [v("a", ORG_A, "admin"), v("b", ORG_B, "agent"), v("c", ORG_A, "agent", "2026-01-01T00:00:00Z")];

  it("uma linha por pessoa, só vínculos ativos na coluna de organizações", () => {
    const l = linhasDeExport(usuarios, vinculos, {}, AGORA);
    expect(l.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(l.find((x) => x.id === "c")?.organizacoes).toBe("");
  });

  it("filtra por organização, papel e situação", () => {
    expect(linhasDeExport(usuarios, vinculos, { tenant_id: ORG_A }, AGORA).map((x) => x.id)).toEqual(["a"]);
    expect(linhasDeExport(usuarios, vinculos, { role: "agent" }, AGORA).map((x) => x.id)).toEqual(["b"]);
    expect(linhasDeExport(usuarios, vinculos, { status: "suspenso" }, AGORA).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("CSV", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1", "-2+3", "@SUM(A1)", "\tx"])(
    "neutraliza injeção de fórmula: %s",
    (valor) => {
      expect(celulaCsv(valor).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("escapa aspas, vírgula e quebra de linha", () => {
    expect(celulaCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it("começa com BOM e cabeçalho fixo", () => {
    const csv = paraCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      "id,email,nome,status,organizacoes,criado_em,ultimo_acesso,email_confirmado,mfa",
    );
  });
});
