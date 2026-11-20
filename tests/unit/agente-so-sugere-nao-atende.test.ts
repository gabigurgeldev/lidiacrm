/**
 * SÓ SUGERE TEM QUE CALAR — a promessa do modo da migration 0255.
 *
 * A empresa que escolhe "Só sugere respostas" pediu, com todas as letras, que a
 * IA não falasse com o cliente. O modo é construído para que isso seja verdade
 * por CONSTRUÇÃO, e não por um filtro a mais em cada porta: o agente fica sem
 * `published_version_id`, que é o predicado de TODA porta de atendimento
 * (turno de entrada, roteador, coordenador, follow-up, operador, o portão do
 * drain, o picker de atribuição). Para o motor, ele é um agente pausado — e
 * pausado calar já é vigiado em `agente-pausado-nao-atende.test.ts`.
 *
 * Este arquivo prende as três coisas que poderiam desfazer isso sem ninguém
 * perceber:
 *
 *   1. alguém usar o carregador do modo (`loadSuggestionOnlyAgentConfig`) num
 *      caminho de atendimento — ele só pode ter UM consumidor, o rascunho do
 *      Inbox;
 *   2. alguém "simplificar" o carregador e deixar de exigir que o agente esteja
 *      FORA do ar (`published_version_id is null`) e no modo;
 *   3. a régua de estado (`no-ar.ts`) passar a contar o modo como "atende".
 *
 * Mede código, não prosa: o caso 1 varre a árvore de verdade.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { agenteAtende, elegivelParaWorkerLegado, estadoDoAgente } from "@/lib/ai/agents/no-ar";

const RAIZ = join(__dirname, "..", "..");
const PASTAS = ["app", "lib", "workers", "components", "hooks", "agente"];

function arquivos(pasta: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho);
    }
  };
  andar(join(RAIZ, pasta));
  return saida;
}

describe("agente que só sugere respostas não atende cliente", () => {
  it("o carregador do modo tem UM consumidor: o rascunho do Inbox", () => {
    const consumidores = PASTAS.flatMap(arquivos)
      .filter((f) => /\bloadSuggestionOnlyAgentConfig\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(RAIZ, f).split("\\").join("/"))
      .filter((f) => f !== "lib/agent-engine/agent/agent-config.ts"); // a definição

    expect(consumidores).toEqual(["lib/agent-engine/agent/draft-reply.ts"]);
  });

  it("o carregador exige agente FORA do ar e no modo — nunca devolve quem atende por outra porta", () => {
    const fonte = readFileSync(join(RAIZ, "lib/agent-engine/agent/agent-config.ts"), "utf8");
    const ini = fonte.indexOf("export async function loadSuggestionOnlyAgentConfig");
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fonte.indexOf("\n}\n", ini));

    expect(corpo).toMatch(/a\.so_sugestao\b/);
    expect(corpo).toMatch(/a\.published_version_id is null/);
    expect(corpo).toMatch(/a\.archived_at is null/);
    expect(corpo).toMatch(/a\.organization_id = \$1/);
    expect(corpo).toMatch(/v\.channel_session_id = \$2/);
  });

  it("as portas de atendimento seguem decidindo por versão PUBLICADA — a flag não abre porta nenhuma", () => {
    // Se alguém trocar o predicado do motor por algo que enxergue a flag, o
    // modo deixa de ser "pausado para o motor" e esta garantia inteira cai.
    const engine = readFileSync(join(RAIZ, "lib/agent-engine/agent/agent-config.ts"), "utf8");
    const candidatos = engine.slice(
      engine.indexOf("export async function loadPublishedAgentCandidates"),
      engine.indexOf("export async function loadPublishedAgentConfig("),
    );
    expect(candidatos).toMatch(/join ai_agent_versions v on v\.id = a\.published_version_id/);
    expect(candidatos).not.toMatch(/so_sugestao/);

    const drain = readFileSync(join(RAIZ, "lib/agent-engine/edge/crm/drain.ts"), "utf8");
    expect(drain).toMatch(/join ai_agent_versions v on v\.id = a\.published_version_id/);
    expect(drain).not.toMatch(/so_sugestao/);
  });

  it("a régua de estado: 'so_sugestao' NÃO atende, nem pelo motor nem pelo worker legado", () => {
    const fatos = { kind: "mcp_agent", is_active: true, published_version_id: null, archived_at: null, so_sugestao: true };

    expect(estadoDoAgente(fatos)).toBe("so_sugestao");
    expect(agenteAtende(fatos)).toBe(false);
    expect(elegivelParaWorkerLegado(fatos)).toBe(false);
  });

  it("select que esquece a coluna lê como 'parado' — a mesma resposta para 'atende?'", () => {
    const semColuna = { kind: "mcp_agent", is_active: true, published_version_id: null, archived_at: null };
    expect(estadoDoAgente(semColuna)).toBe("parado");
    expect(agenteAtende(semColuna)).toBe(false);
  });
});
