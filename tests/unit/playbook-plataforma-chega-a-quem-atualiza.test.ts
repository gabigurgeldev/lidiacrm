/**
 * A camada plataforma do playbook chega a quem já instalou — e só a quem nunca
 * a editou.
 *
 * O seed do worker só semeia quando não há ponteiro, então editar
 * `lib/agent-engine/playbooks/platform.md` não mudava nada em instalação
 * existente. A migration mais recente que carrega o texto (delimitada por
 * `$plataforma$`) move o ponteiro só quando o conteúdo atual tem o md5 de uma
 * versão distribuída.
 *
 * O que este teste trava:
 *  1. o texto da migration MAIS RECENTE (e do bloco do baseline) é o `.md`
 *     atual — quem edita o `.md` sem migration nova fica vermelho aqui;
 *  2. a lista de hashes dessa migration contém o md5 de TODA versão que
 *     migrations anteriores distribuíram (mais a do seed original), e não
 *     contém o do texto novo (senão a migration se reaplicaria sobre si);
 *  3. a migration move o ponteiro só com o hash na lista e a cada aplicação.
 *
 * Sabotagens medidas: mudar uma palavra do `.md` ⇒ (1) vermelho; tirar o hash
 * original da lista ⇒ (2) vermelho.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const MIGRATIONS = path.join(RAIZ, "supabase/migrations");
const DELIM = "$plataforma$";
/** md5 do platform.md que o seed do worker distribuiu antes de qualquer migration. */
const HASH_DO_SEED_ORIGINAL = "d6ef7e6b5d3e40a2c3d81051ba60106f";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const md5 = (s: string) => crypto.createHash("md5").update(lf(s), "utf8").digest("hex");

function textoEntreDelimitadores(sql: string): string {
  const a = sql.indexOf(DELIM);
  const b = sql.indexOf(DELIM, a + DELIM.length);
  expect(a, "delimitador $plataforma$ não encontrado").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return sql.slice(a + DELIM.length, b);
}

function hashesDaLista(sql: string): string[] {
  const m = /md5\(replace\(atual\.content[^)]*\)\) in \(([^)]*)\)/.exec(sql);
  expect(m, "lista de hashes não encontrada").not.toBeNull();
  return [...m![1]!.matchAll(/'([0-9a-f]{32})'/g)].map((x) => x[1]!);
}

const migracoes = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: lf(fs.readFileSync(path.join(MIGRATIONS, f), "utf8")) }))
  .filter((m) => m.sql.includes(DELIM));

describe("camada plataforma do playbook chega a quem atualiza", () => {
  const md = lf(fs.readFileSync(path.join(RAIZ, "lib/agent-engine/playbooks/platform.md"), "utf8"));

  it("existe migration que carrega o texto (guarda de vacuidade)", () => {
    expect(migracoes.length).toBeGreaterThan(0);
  });

  it("o texto da migration mais recente é o platform.md atual", () => {
    const ultima = migracoes[migracoes.length - 1]!;
    expect(textoEntreDelimitadores(ultima.sql), `${ultima.f} está desatualizada: editou o .md? faça migration nova`).toBe(md);
  });

  it("o bloco do baseline carrega o mesmo texto", () => {
    const baseline = lf(fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8"));
    const blocos = baseline.split(DELIM);
    // blocos ímpares são os textos; o último texto é o vigente
    const textos = blocos.filter((_, i) => i % 2 === 1);
    expect(textos.length).toBeGreaterThan(0);
    expect(textos[textos.length - 1]).toBe(md);
  });

  it("a lista de hashes cobre tudo que já foi distribuído, e não o texto novo", () => {
    const ultima = migracoes[migracoes.length - 1]!;
    const lista = hashesDaLista(ultima.sql);
    const distribuidos = [HASH_DO_SEED_ORIGINAL, ...migracoes.slice(0, -1).map((m) => md5(textoEntreDelimitadores(m.sql)))];
    for (const h of distribuidos) expect(lista, `hash distribuído ${h} fora da lista`).toContain(h);
    expect(lista).not.toContain(md5(md));
  });

  it("o ponteiro só se move quando há versão nova inserida, e só o global", () => {
    const sql = migracoes[migracoes.length - 1]!.sql;
    expect(sql).toMatch(/update playbook_pointers p\s+set version_id = \(select id from nova\)/);
    expect(sql).toMatch(/where p\.organization_id is null\s+and p\.layer = 'platform'\s+and exists \(select 1 from nova\)/);
  });
});
