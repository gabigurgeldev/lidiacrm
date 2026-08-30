/**
 * Flow Engine — o grafo, validado em DOIS passes.
 *
 * É aqui que o registry paga. O follow-up valida o grafo com uma união
 * discriminada de 8 tipos (`lib/followup/graph-schema.ts`), e o preço disso é
 * que o conjunto de tipos é fechado pelo compilador: nó novo exige editar o
 * schema, o mapa de ramos, o executor e a tela.
 *
 * Aqui o passe 1 valida só a FORMA (id, tipo, rótulo, posição, config opaca) e
 * o passe 2 entrega a `config` ao `configSchema` do nó registrado. Um tipo novo
 * não toca este arquivo.
 *
 * O custo dessa escolha, dito na cara: `config` é `unknown` até o passe 2, e
 * quem ler um `FlowNodeShape` sem passar por `analisarGrafo` não tem tipo
 * nenhum. Por isso o motor NUNCA lê `node.config` direto — só o resultado de
 * `analisarGrafo`.
 */

import { z } from "zod";

import { buscarNo } from "./registry";
import { RAMO_PADRAO, type FlowBranch } from "./types";

// ─────────────────────────────── passe 1: forma ──────────────────────────────

export const flowNodeShapeSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** O tipo registrado. Não é enum: é o registry que decide o que existe. */
  type: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  position: z.strictObject({ x: z.number(), y: z.number() }),
  config: z.unknown(),
});
export type FlowNodeShape = z.infer<typeof flowNodeShapeSchema>;

/**
 * Toda aresta nomeia um ramo do nó de origem — inclusive o pega-tudo, que se
 * escreve `else`. Um dialeto só, de propósito: o follow-up mantém três
 * (`class_match`, `cond_result`, `branch`) por compatibilidade, e o próprio
 * arquivo dele registra que isso já produziu tela certa com roteamento errado.
 */
export const flowEdgeSchema = z.strictObject({
  id: z.string().min(1).max(96),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  branch_id: z.string().min(1).max(64),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.strictObject({
  nodes: z.array(flowNodeShapeSchema).min(1).max(200),
  edges: z.array(flowEdgeSchema).max(400),
});
export type FlowGraph = z.infer<typeof flowGraphSchema>;

// ──────────────────────────── passe 2: registry ──────────────────────────────

export interface ErroDeGrafo {
  /** O nó (ou aresta) a que o erro se ancora — a tela destaca por este id. */
  ancora: string;
  codigo: string;
  mensagem: string;
}

export interface NoAnalisado {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  /** Já validado pelo `configSchema` do nó. */
  config: unknown;
  branches: FlowBranch[];
  category: string;
}

export interface GrafoAnalisado {
  nos: NoAnalisado[];
  arestas: FlowEdge[];
  erros: ErroDeGrafo[];
}

/**
 * Passe 2. NÃO lança: devolve os erros ancorados, porque um rascunho meio
 * montado precisa poder ser salvo e desenhado. Quem recusa é a publicação
 * (`validate-publish.ts`), não o parser.
 */
export function analisarGrafo(grafo: FlowGraph): GrafoAnalisado {
  const erros: ErroDeGrafo[] = [];
  const nos: NoAnalisado[] = [];

  const vistos = new Set<string>();
  for (const bruto of grafo.nodes) {
    if (vistos.has(bruto.id)) {
      erros.push({
        ancora: bruto.id,
        codigo: "id_duplicado",
        mensagem: `Existe mais de um bloco com o id "${bruto.id}".`,
      });
      continue;
    }
    vistos.add(bruto.id);

    const def = buscarNo(bruto.type);
    if (def === undefined) {
      erros.push({
        ancora: bruto.id,
        codigo: "tipo_desconhecido",
        mensagem: `O bloco "${bruto.label}" é de um tipo que esta versão não conhece (${bruto.type}).`,
      });
      continue;
    }

    const parsed = def.configSchema.safeParse(bruto.config);
    if (!parsed.success) {
      erros.push({
        ancora: bruto.id,
        codigo: "config_invalida",
        mensagem: `O bloco "${bruto.label}" está incompleto: ${primeiroProblema(parsed.error)}`,
      });
      continue;
    }

    nos.push({
      id: bruto.id,
      type: bruto.type,
      label: bruto.label,
      position: bruto.position,
      config: parsed.data,
      branches: def.branches(parsed.data as never),
      category: def.category,
    });
  }

  return { nos, arestas: grafo.edges, erros };
}

function primeiroProblema(erro: z.ZodError): string {
  const primeiro = erro.issues[0];
  if (primeiro === undefined) return "configuração inválida.";
  const onde = primeiro.path.length > 0 ? `${primeiro.path.join(".")}: ` : "";
  return `${onde}${primeiro.message}`;
}

// ──────────────────────────────── navegação ──────────────────────────────────

/**
 * A aresta que sai de `nodeId` pelo ramo `branchId`, ou `null` quando o ramo
 * não tem saída.
 *
 * Ramo sem saída NÃO é erro de execução: é o fim daquele caminho, e o motor
 * completa com desfecho próprio. Tratar como falha mandaria para `dead` um
 * fluxo cujo autor desenhou de propósito um ramo que termina ali.
 */
export function arestaDoRamo(
  arestas: readonly FlowEdge[],
  nodeId: string,
  branchId: string,
): FlowEdge | null {
  return arestas.find((a) => a.source === nodeId && a.branch_id === branchId) ?? null;
}

export function noPorId(nos: readonly NoAnalisado[], id: string): NoAnalisado | null {
  return nos.find((n) => n.id === id) ?? null;
}

export { RAMO_PADRAO };
