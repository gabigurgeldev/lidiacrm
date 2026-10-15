import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { skillMatcherSchema, MAX_SKILL_BODY_LINES } from "@/lib/agent-engine/agent/skills";
import { NICHOS } from "@/lib/ai/agents/construtor/nicho";
import { MODELOS_DE_AGENTE, montarModelo } from "@/lib/ai/agents/modelos-por-nicho";
import { SKILLS_POR_NICHO, skillNamesDoNovoAgente } from "@/lib/ai/skills/skills-por-nicho";
import { PROMPT_TEMPLATES } from "@/lib/schemas/onboarding";

/**
 * O CATÁLOGO DE SKILLS POR NICHO É UMA COISA SÓ EM TRÊS LUGARES.
 *
 * A lista padrão de cada ramo mora em TypeScript (`SKILLS_POR_NICHO`), o
 * conteúdo mora em SQL (migration 0242 e o apêndice do `baseline.sql`, que é o
 * que o self-hoster aplica), e o agente grava NOMES. Nada no typecheck amarra
 * os três: um nome digitado errado no mapa vira uma skill que o agente "tem" e
 * que nunca carrega — a tela mostra marcada, o runtime ignora (nome inexistente
 * é ignorado de propósito, para versão publicada não quebrar).
 *
 * E o md5 de cada bloco é constante escrita à mão. Quem edita o corpo e esquece
 * o md5 não ganha erro no CI: ganha `raise exception` no `update.sh` do CLIENTE,
 * que roda sem `ON_ERROR_STOP` e engole o resto do arquivo. Este teste recalcula.
 */
const RAIZ = process.cwd();
const BASELINE = path.join(RAIZ, "supabase/baseline.sql");
const MIGRATION = path.join(RAIZ, "supabase/migrations/20261014130000_0242_habilidades_por_nicho.sql");

interface Semente {
  nome: string;
  md5Declarado: string;
  corpo: string;
  descricao: string;
  matcher: unknown;
  nichos: string[];
}

const sqlTexto = (s: string) => s.replace(/''/g, "'");

/** Os blocos `do $pub$ … $pub$;` que semeiam skill COM `nichos` (forma da 0242). */
function sementes(arquivo: string): Map<string, Semente> {
  const sql = readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n");
  const out = new Map<string, Semente>();
  for (const [bloco] of sql.matchAll(/do \$pub\$[\s\S]*?\n\$pub\$;/g)) {
    if (!bloco.includes("insert into skill_versions (organization_id, name, description, body, matcher, nichos)")) continue;
    const corpo = /values \(null, '([a-z0-9-]+)', v_desc, \$body\$([\s\S]*?)\$body\$/.exec(bloco);
    const md5 = /v_md5\s+constant text\s+:= '([0-9a-f]{32})'/.exec(bloco);
    const desc = /v_desc\s+constant text\s+:= '((?:[^']|'')*)';/.exec(bloco);
    const matcher = /v_matcher constant jsonb\s+:= '((?:[^']|'')*)'::jsonb;/.exec(bloco);
    const nichos = /v_nichos\s+constant text\[\] := (?:'\{\}'::text\[\]|array\[([^\]]*)\]::text\[\]);/.exec(bloco);
    if (!corpo || !md5 || !desc || !matcher || !nichos) {
      throw new Error(`bloco de skill fora da forma esperada:\n${bloco.slice(0, 400)}`);
    }
    out.set(corpo[1]!, {
      nome: corpo[1]!,
      md5Declarado: md5[1]!,
      corpo: corpo[2]!,
      descricao: sqlTexto(desc[1]!),
      matcher: JSON.parse(sqlTexto(matcher[1]!)),
      nichos: nichos[1] ? [...nichos[1].matchAll(/'([^']+)'/g)].map((m) => m[1]!) : [],
    });
  }
  return out;
}

const doBaseline = sementes(BASELINE);
const daMigration = sementes(MIGRATION);

describe("catálogo de skills por nicho", () => {
  it("CONTROLE: a varredura acha o catálogo nos dois arquivos", () => {
    // Sem isto, uma mudança na forma do bloco devolveria zero sementes e todo caso
    // abaixo passaria varrendo o vazio.
    expect(daMigration.size).toBeGreaterThanOrEqual(20);
    expect(doBaseline.size).toBe(daMigration.size);
  });

  it("o baseline traz exatamente o que a migration traz (quem atualiza recebe o mesmo catálogo)", () => {
    for (const [nome, s] of daMigration) {
      expect(doBaseline.get(nome), `${nome} está na migration e não no baseline`).toEqual(s);
    }
  });

  it("o md5 declarado de cada bloco é o md5 do corpo", () => {
    for (const s of daMigration.values()) {
      const real = createHash("md5").update(s.corpo, "utf8").digest("hex");
      expect(real, `${s.nome}: corpo editado sem recalcular v_md5 — o update.sh do cliente levantaria exceção`).toBe(
        s.md5Declarado,
      );
    }
  });

  it("todo corpo cabe no teto de linhas e todo matcher tem a forma que o runtime aceita", () => {
    for (const s of daMigration.values()) {
      expect(s.corpo.split("\n").length, `${s.nome} passa de ${MAX_SKILL_BODY_LINES} linhas`).toBeLessThanOrEqual(
        MAX_SKILL_BODY_LINES,
      );
      expect(skillMatcherSchema.safeParse(s.matcher).success, `${s.nome}: matcher inválido`).toBe(true);
      expect(s.descricao.length).toBeGreaterThan(40);
    }
  });

  it("todo ramo semeado é um ramo de verdade", () => {
    const validos = new Set<string>(NICHOS.filter((n) => n !== "generico"));
    for (const s of daMigration.values()) {
      for (const n of s.nichos) expect(validos.has(n), `${s.nome} declara o ramo desconhecido "${n}"`).toBe(true);
    }
  });

  it("todo nome do mapa existe como skill semeada daquele ramo", () => {
    for (const nicho of NICHOS) {
      for (const nome of SKILLS_POR_NICHO[nicho]) {
        const s = doBaseline.get(nome);
        expect(s, `${nicho} → ${nome}: não existe no baseline`).toBeDefined();
        expect(s?.nichos, `${nicho} → ${nome}: a semente não declara este ramo`).toContain(nicho);
      }
    }
  });

  it("toda skill de ramo semeada está no mapa do seu ramo (senão nenhum agente a ganha sozinho)", () => {
    for (const s of daMigration.values()) {
      for (const n of s.nichos) {
        expect(SKILLS_POR_NICHO[n as keyof typeof SKILLS_POR_NICHO], `${s.nome} não está no mapa de ${n}`).toContain(
          s.nome,
        );
      }
    }
  });

  it("o modelo de cada ramo já nasce com as skills do ramo; o genérico fica no padrão", () => {
    for (const modelo of MODELOS_DE_AGENTE) {
      const campos = montarModelo(modelo, PROMPT_TEMPLATES[0], { onde: "a loja", capacidades: [] });
      if (modelo.id === "generico") {
        expect(campos.skill_names).toBeNull();
      } else {
        expect(campos.skill_names).toEqual([...SKILLS_POR_NICHO[modelo.id as keyof typeof SKILLS_POR_NICHO]]);
      }
    }
    expect(skillNamesDoNovoAgente(undefined)).toBeNull();
  });
});

/**
 * Palavra de skill que CONTÉM uma palavra de passagem do modelo é palavra morta: a
 * passagem para a pessoa é decidida antes do casamento de skills e encerra o turno
 * (`inbound-turn.ts`, `decidirPedidoDeHumano` antes de `matchSkills`). A skill nunca
 * chegaria a ser lida com aquela frase. Lista de exceções só encolhe, e cada uma diz
 * por que é aceitável.
 */
// Vazia de propósito. (Fora do alcance desta varredura: `agendamento`, semeada na forma
// da 0191, tem "cancelar o horário" — que no curso a passagem "cancelar" engole. É o
// desfecho certo para quem quer cancelar, e está registrado aqui para não ser redescoberto.)
const PALAVRA_MORTA_ACEITA: Record<string, string> = {};

describe("palavras das skills × palavras de passagem do modelo", () => {
  it("nenhuma palavra de skill é engolida pela passagem do próprio ramo", () => {
    const universais = [...doBaseline.values()].filter((s) => s.nichos.length === 0);
    // As duas universais semeadas antes da 0242 têm outra forma de bloco; o matcher
    // delas é conferido pelo nome conhecido, pela varredura da 0069/0191.
    const mortas: string[] = [];
    for (const modelo of MODELOS_DE_AGENTE) {
      const passagem = montarModelo(modelo, PROMPT_TEMPLATES[0], { onde: "x", capacidades: [] }).handoff_keywords.map(
        (p) => p.toLowerCase(),
      );
      const doRamo = [...doBaseline.values()].filter((s) => s.nichos.includes(modelo.id));
      for (const s of [...universais, ...doRamo]) {
        const m = s.matcher as { any_keywords: string[] };
        for (const k of m.any_keywords) {
          const chave = `${modelo.id}:${s.nome}:${k}`;
          if (passagem.some((p) => k.toLowerCase().includes(p)) && !(chave in PALAVRA_MORTA_ACEITA)) mortas.push(chave);
        }
      }
    }
    expect(mortas).toEqual([]);
  });

  it("toda exceção aceita tem motivo escrito", () => {
    for (const [chave, motivo] of Object.entries(PALAVRA_MORTA_ACEITA)) {
      expect(motivo.length, `${chave} sem motivo`).toBeGreaterThan(40);
    }
  });
});
