/**
 * O turno do agente não ganha saída nova por FORA da transação sem passar por aqui.
 *
 * O ensaio (`lib/agent-engine/ensaio`) roda o turno de produção dentro de uma
 * transação que é desfeita no fim — e isso só vale para o que passa pelo `pool`.
 * O que sai pelo cliente HTTP do Supabase (`deps.crmCfg`), por token efêmero ou
 * por `fetch` direto escapa do `ROLLBACK`: num ensaio, gravaria de verdade.
 *
 * Por isso cada uso de `deps.crmCfg` em `inbound-turn.ts` está listado abaixo
 * com o porquê de ser seguro no ensaio. Um uso novo reprova até alguém decidir:
 * ou ele é só leitura que não depende do que o ensaio criou, ou ele ganha o
 * desvio `deps.ensaio` como o espelho de etapa e as capacidades do CRM.
 *
 * A lista SÓ ENCOLHE: entrada sem uso correspondente também reprova.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ARQUIVO = path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts");

interface Permitido {
  nome: string;
  /** Casa com o trecho que vai até 6 linhas antes do uso. */
  padrao: RegExp;
  motivo: string;
}

const PERMITIDOS: Permitido[] = [
  {
    nome: "declaração do tipo",
    padrao: /crmCfg: CrmEdgeConfig;$/,
    motivo: "não é uso.",
  },
  {
    nome: "fábrica do canal padrão",
    padrao: /canalPadraoDoTurno\(pool: pg\.Pool, crmCfg/,
    motivo: "o ensaio usa só as LEITURAS deste canal (saúde do número, pelo `pool`); o envio é capturado.",
  },
  {
    nome: "canal padrão",
    padrao: /deps\.channel \?\?/,
    motivo: "o ensaio injeta `deps.channel` (canal de captura); o padrão nunca é montado.",
  },
  {
    nome: "configuração do canal padrão",
    padrao: /const turnCrmCfg =\s*\n.*deps\.crmCfg/,
    motivo: "`turnCrmCfg` só alimenta o canal padrão, que o ensaio substitui pelo de captura.",
  },
  {
    nome: "contexto do lead",
    padrao: /getLeadContext\(\s*pool,\s*deps\.crmCfg/,
    motivo: "`getLeadContext` lê pelo `pool` — dentro da transação.",
  },
  {
    nome: "espelho de etapa",
    padrao: /deps\.ensaio !== undefined[\s\S]*mirrorLeadStageToCrm\(pool, deps\.crmCfg/,
    motivo: "desviado no ensaio: move o card pelo cliente HTTP.",
  },
  {
    nome: "capacidades do CRM",
    padrao: /deps\.ensaio !== undefined[\s\S]*buildMcpTurnTools\(deps\.crmCfg/,
    motivo: "desviado no ensaio: token efêmero e escritas pela ponte MCP.",
  },
  {
    nome: "referência de skill",
    padrao: /readSkillReference\(\s*\{ admin: deps\.crmCfg\.supabase \}/,
    motivo: "só lê o arquivo da skill no Storage; não depende do contato do ensaio.",
  },
  {
    nome: "mídia nativa",
    padrao: /admin: deps\.crmCfg\.supabase,$/,
    motivo: "só assina URL de mídia já existente; as mensagens do ensaio são texto.",
  },
];

function usos(fonte: string) {
  const linhas = fonte.replace(/\r\n/g, "\n").split("\n");
  const resultado: Array<{ linha: number; trecho: string }> = [];
  linhas.forEach((l, i) => {
    if (!l.includes("crmCfg")) return;
    if (/^\s*(\/\/|\*)/.test(l)) return;
    resultado.push({ linha: i + 1, trecho: linhas.slice(Math.max(0, i - 6), i + 1).join("\n").trim() });
  });
  return resultado;
}

describe("o turno não escapa da transação do ensaio sem decisão escrita", () => {
  const fonte = fs.readFileSync(ARQUIVO, "utf8");

  it("todo uso de `crmCfg` está na lista, e toda entrada da lista é usada", () => {
    const encontrados = usos(fonte);
    expect(encontrados.length).toBeGreaterThan(3);

    const usadas = new Set<string>();
    const semDono: string[] = [];
    for (const u of encontrados) {
      const dono = PERMITIDOS.find((p) => p.padrao.test(u.trecho));
      if (dono === undefined) semDono.push(`linha ${u.linha}:\n${u.trecho}`);
      else usadas.add(dono.nome);
    }
    expect(semDono, "uso novo de crmCfg no turno — o ensaio o deixaria escapar?").toEqual([]);
    expect(PERMITIDOS.map((p) => p.nome).filter((n) => !usadas.has(n))).toEqual([]);
  });

  it("nenhum token efêmero nem fetch direto no turno", () => {
    expect(fonte).not.toMatch(/mintEphemeralToken\(/);
    expect(fonte).not.toMatch(/(?<![\w.])fetch\(/);
  });
});
