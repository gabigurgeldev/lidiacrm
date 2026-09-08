/**
 * Flow Engine — de onde um grafo COMEÇA, e sob qual kind.
 *
 * Puro, e DERIVADO do registry: o nó de início é o (único) nó `category:
 * "trigger"`, e o kind é "manual" quando esse gatilho não escuta evento nenhum
 * (`eventos` vazio) — a mesma verdade que o matcher usa para nunca armar um
 * gatilho manual por evento. Nada digitado à mão em paralelo.
 *
 * Exige `garantirNosRegistrados()` antes: sem o registry cheio, `buscarNo`
 * devolve `undefined` e o gatilho parece não existir.
 */
import { flowGraphSchema } from "./graph-schema";
import { buscarNo } from "./registry";

export type KindDoGatilho = "event" | "manual";

/** O nó de início do grafo (id + type), ou `null` quando não há gatilho. */
export function acharNoDeGatilho(graph: unknown): { id: string; type: string } | null {
  const parsed = flowGraphSchema.safeParse(graph);
  if (!parsed.success) return null;
  for (const n of parsed.data.nodes) {
    if (buscarNo(n.type)?.category === "trigger") return { id: n.id, type: n.type };
  }
  return null;
}

/**
 * O kind do gatilho de um grafo publicado: "manual" quando o nó de início não
 * escuta evento (só o botão o dispara); "event" caso contrário. `null` quando o
 * grafo não tem gatilho reconhecível.
 */
export function kindDoGatilho(graph: unknown): KindDoGatilho | null {
  const no = acharNoDeGatilho(graph);
  if (no === null) return null;
  const def = buscarNo(no.type);
  return (def?.eventos?.length ?? 0) > 0 ? "event" : "manual";
}
