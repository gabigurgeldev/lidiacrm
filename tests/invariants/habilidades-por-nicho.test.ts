import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { SKILLS_POR_NICHO } from "@/lib/ai/skills/skills-por-nicho";

/**
 * O CATÁLOGO POR NICHO CHEGA UMA VEZ SÓ, NO BANCO QUE O CLIENTE TEM.
 *
 * `scripts/test-db.sh` aplica o `baseline.sql` em modo install e depois o
 * RE-APLICA (modo update, o que o `update.sh` do self-host faz a cada versão).
 * `skill_versions` não tem índice único: a única coisa que impede a segunda
 * passada de duplicar cada skill é a procura por md5 + descrição + matcher +
 * nichos dos blocos da 0242. Se ela falhar (um campo comparado com tipo errado,
 * por exemplo), o update não dá erro — ele só insere outra linha e repointa.
 * Este arquivo é quem vê isso.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const DE_RAMO = Object.entries(SKILLS_POR_NICHO).flatMap(([nicho, nomes]) => nomes.map((nome) => ({ nicho, nome })));
const UNIVERSAIS_NOVAS = [
  "cliente-insatisfeito",
  "comprovante-de-pagamento",
  "dados-pessoais-lgpd",
  "retomada-de-conversa",
  "risco-a-vida",
];

describe("catálogo de skills por nicho no banco (install + update)", () => {
  it("CONTROLE: o mapa tem skills de ramo para conferir", () => {
    expect(DE_RAMO.length).toBeGreaterThanOrEqual(15);
  });

  it("cada skill do catálogo tem UMA versão de plataforma, mesmo depois do update", () => {
    const nomes = [...DE_RAMO.map((s) => s.nome), ...UNIVERSAIS_NOVAS];
    const lista = nomes.map((n) => `'${n}'`).join(",");
    const linhas = sql(`
      select name || '=' || count(*)
        from public.skill_versions
       where organization_id is null and name in (${lista})
       group by name
       order by name;
    `)
      .split("\n")
      .filter(Boolean);
    expect(linhas.length, "alguma skill do catálogo não foi semeada").toBe(nomes.length);
    const duplicadas = linhas.filter((l) => !l.endsWith("=1"));
    expect(duplicadas, "o update re-inseriu a skill em vez de reconhecê-la").toEqual([]);
  });

  it("o ponteiro de plataforma de cada skill aponta para a versão semeada, com o ramo certo", () => {
    for (const { nicho, nome } of DE_RAMO) {
      const nichos = sql(`
        select array_to_string(v.nichos, ',')
          from public.skill_pointers p
          join public.skill_versions v on v.id = p.version_id
         where p.organization_id is null and p.name = '${nome}';
      `);
      expect(nichos.split(","), `${nome}`).toContain(nicho);
    }
    for (const nome of UNIVERSAIS_NOVAS) {
      const nichos = sql(`
        select coalesce(array_length(v.nichos, 1), 0)
          from public.skill_pointers p
          join public.skill_versions v on v.id = p.version_id
         where p.organization_id is null and p.name = '${nome}';
      `);
      expect(nichos, `${nome} deveria ser universal`).toBe("0");
    }
  });

  it("as skills anteriores ao catálogo continuam universais", () => {
    const nichos = sql(`
      select string_agg(p.name || '=' || coalesce(array_length(v.nichos, 1), 0), ',' order by p.name)
        from public.skill_pointers p
        join public.skill_versions v on v.id = p.version_id
       where p.organization_id is null and p.name in ('objecao-preco', 'agendamento');
    `);
    expect(nichos).toBe("agendamento=0,objecao-preco=0");
  });
});
