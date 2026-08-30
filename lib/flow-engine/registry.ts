/**
 * Flow Engine — o registry de nós.
 *
 * Espelha `lib/automation/actions/index.ts` (registrar + buscar), com uma
 * diferença que importa: aqui o registry é a fonte do CONTRATO, não só do
 * despacho. O schema do grafo, a paleta do builder e os `event_type` que o
 * matcher escuta são todos DERIVADOS deste mapa — nenhuma lista digitada à mão
 * em paralelo, que é a forma clássica de os dois divergirem em silêncio.
 */

import type { FlowNodeDefinition } from "./types";

const registro = new Map<string, FlowNodeDefinition<never>>();

/**
 * Registra um nó. Recusa tipo repetido em vez de sobrescrever: dois arquivos
 * declarando `crm.add_tag` é defeito, e o último a carregar venceria por acaso
 * da ordem de import.
 */
export function registrarNo<C>(def: FlowNodeDefinition<C>): void {
  const existente = registro.get(def.type);
  if (existente !== undefined && existente !== (def as unknown as FlowNodeDefinition<never>)) {
    throw new Error(`no de fluxo duplicado: ${def.type}`);
  }
  registro.set(def.type, def as unknown as FlowNodeDefinition<never>);
}

/** `undefined` quando o tipo não existe — quem decide o erro é quem chamou. */
export function buscarNo(type: string): FlowNodeDefinition<never> | undefined {
  return registro.get(type);
}

/**
 * Como `buscarNo`, mas lança. Use no motor, onde um tipo desconhecido só chega
 * se a validação de publicação deixou passar — e aí calar seria pior.
 */
export function exigirNo(type: string): FlowNodeDefinition<never> {
  const def = registro.get(type);
  if (def === undefined) throw new Error(`no de fluxo desconhecido: ${type}`);
  return def;
}

export function todosOsNos(): FlowNodeDefinition<never>[] {
  return [...registro.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function tiposRegistrados(): string[] {
  return todosOsNos().map((n) => n.type);
}

/** Só para teste: devolve o registry ao vazio. Nunca chamar em runtime. */
export function limparRegistroParaTeste(): void {
  registro.clear();
}
