/**
 * Flow Engine — a FRENTE de execução, e as decisões puras que a governam.
 *
 * ═══ Por que este arquivo existe separado do motor ═══
 *
 * O motor (`engine.ts`) é I/O: reclama, persiste, registra passo. As decisões
 * que o paralelo introduz — quantas frentes um fork abre, se um merge já pode
 * seguir, se um laço acabou, quem é cancelado quando a corrida termina — são
 * ARITMÉTICA, e aritmética não precisa de Postgres para ser provada.
 *
 * É a mesma razão pela qual `condicoes.ts` e `auto-layout.ts` moram fora do
 * motor: o caso de teste que importa aqui ("dois ramos paralelos gravando a
 * mesma variável não se sobrescrevem") tem de ser escrito sem subir banco, ou
 * não vai ser escrito.
 *
 * ⚠️ Nada aqui fala com o Supabase, e o teste de arquitetura cobra isso.
 */

import type { EscopoDaFrente } from "./types";

/** Os estados de uma frente. Espelha o CHECK `flow_execution_frames_status_check`. */
export const ESTADOS_DA_FRENTE = ["ready", "waiting", "done", "cancelled"] as const;
export type EstadoDaFrente = (typeof ESTADOS_DA_FRENTE)[number];

/** Como duas ou mais frentes se reencontram. Espelha `flow_execution_joins.modo`. */
export type ModoDeEncontro = "todas" | "primeira";

/**
 * Uma linha de `flow_execution_frames`, do jeito que o motor a lê.
 *
 * Espelho 1:1 das colunas que o motor USA — não da tabela inteira, pela mesma
 * razão que `FlowExecutionRow` não espelha `flow_executions` inteira: campo que
 * ninguém lê no motor não deve aparecer no tipo do motor, senão o tipo mente
 * sobre o que é necessário.
 */
export interface FrenteRow {
  id: string;
  organization_id: string;
  execution_id: string;
  parent_frame_id: string | null;
  node_id: string;
  status: EstadoDaFrente;
  next_eval_at: string | null;
  steps_taken: number;
  vars: Record<string, unknown>;
  fork_node_id: string | null;
  awaiting_event_type: string | null;
  awaiting_match: Record<string, unknown> | null;
  wait_deadline: string | null;
  loop_node_id: string | null;
  loop_index: number | null;
  loop_total: number | null;
}

/** O que o motor escreve numa frente. Todo campo é opcional: patch, não replace. */
export interface FrentePatch {
  node_id?: string;
  status?: EstadoDaFrente;
  next_eval_at?: string | null;
  claimed_until?: string | null;
  steps_taken?: number;
  vars?: Record<string, unknown>;
  awaiting_event_type?: string | null;
  awaiting_match?: Record<string, unknown> | null;
  wait_deadline?: string | null;
  loop_node_id?: string | null;
  loop_index?: number | null;
  loop_total?: number | null;
  updated_at?: string;
}

/** Uma frente a criar. O motor traduz para INSERT. */
export interface FrenteNova {
  organization_id: string;
  execution_id: string;
  parent_frame_id: string | null;
  node_id: string;
  status: EstadoDaFrente;
  next_eval_at: string;
  steps_taken: number;
  vars: Record<string, unknown>;
  fork_node_id: string | null;
}

// ─────────────────────────────── o fork ──────────────────────────────────────

/**
 * As frentes que um fork abre — uma por ARESTA, não uma por ramo declarado.
 *
 * A diferença importa e é o defeito clássico do fan-out: um ramo do fork que
 * ninguém ligou no canvas não é uma frente que morre logo, é uma frente que
 * NUNCA DEVERIA EXISTIR. Se ela fosse criada, `esperadas` contaria N e o merge
 * em modo `todas` esperaria para sempre por uma frente sem destino — um fluxo
 * travado, sem erro, exatamente o modo de falha mais caro de diagnosticar.
 *
 * Por isso quem chama passa os DESTINOS já resolvidos, e o número de frentes é
 * o número de destinos. `esperadas` sai daqui, não da config do nó.
 */
export function frentesDoFork(input: {
  organizationId: string;
  executionId: string;
  paiId: string;
  forkNodeId: string;
  /** Um destino por aresta que sai do fork, na ordem dos ramos. */
  destinos: readonly string[];
  /** As vars locais do pai, HERDADAS por cada filha. */
  varsDoPai: Record<string, unknown>;
  agoraIso: string;
}): FrenteNova[] {
  return input.destinos.map((destino) => ({
    organization_id: input.organizationId,
    execution_id: input.executionId,
    parent_frame_id: input.paiId,
    node_id: destino,
    status: "ready" as const,
    next_eval_at: input.agoraIso,
    steps_taken: 0,
    // Cópia, nunca referência: as filhas partem do mesmo estado e divergem a
    // partir dali. Compartilhar o objeto faria uma enxergar a escrita da outra,
    // que é precisamente o que o `vars` local existe para impedir.
    vars: { ...input.varsDoPai },
    fork_node_id: input.forkNodeId,
  }));
}

// ────────────────────────────── o encontro ───────────────────────────────────

/** O estado de um encontro, do jeito que o motor o lê. */
export interface EncontroRow {
  modo: ModoDeEncontro;
  esperadas: number;
  chegadas: number;
  resolvido_em: string | null;
}

export type VeredictoDoEncontro =
  /** Esta frente segue adiante; é ela que carrega o fluxo daqui para a frente. */
  | { kind: "segue"; cancelar_irmas: boolean }
  /** Esta frente cumpriu o papel dela e para aqui. O fluxo continua noutra. */
  | { kind: "para" };

/**
 * O que acontece com a frente que acabou de chegar ao merge.
 *
 * `chegadas` é a contagem DEPOIS de somar esta frente — quem chama já
 * incrementou, porque o incremento tem de ser atômico no banco (`update ... set
 * chegadas = chegadas + 1 returning *`) e não pode ser recalculado aqui.
 *
 * ═══ Por que `todas` deixa passar só a ÚLTIMA ═══
 *
 * Alguém tem de seguir, e só uma pode: duas frentes saindo do mesmo merge
 * refariam o fan-out sem ninguém ter pedido. A última é a escolha natural
 * porque é a única que sabe que todas chegaram — as anteriores param sem saber
 * se são as últimas.
 *
 * ═══ Por que `primeira` cancela as irmãs ═══
 *
 * Sem o cancelamento, a corrida "cliente responde OU 24h passam" continuaria
 * rodando o ramo do tempo depois de o cliente ter respondido, e a pessoa
 * receberia a cobrança automática logo após ter dito que ia pagar. O
 * cancelamento é o que faz a palavra "OU" significar OU.
 *
 * ⚠️ `resolvido_em` já preenchido significa que alguém venceu antes. A frente
 * que chega depois para, mesmo em modo `todas`: é o caminho do RETRY, e sem
 * esta guarda um merge poderia disparar duas vezes.
 */
export function veredictoDoEncontro(encontro: EncontroRow): VeredictoDoEncontro {
  if (encontro.resolvido_em !== null) return { kind: "para" };
  if (encontro.modo === "primeira") return { kind: "segue", cancelar_irmas: true };
  if (encontro.chegadas >= encontro.esperadas) return { kind: "segue", cancelar_irmas: false };
  return { kind: "para" };
}

// ─────────────────────────────── o laço ──────────────────────────────────────

export type PassoDoLaco =
  /** Executa o corpo com este índice. */
  | { kind: "corpo"; indice: number; total: number }
  /** Acabou: segue pela saída de conclusão. */
  | { kind: "fim" };

/**
 * A próxima volta do laço, ou o fim.
 *
 * `indiceAtual` é `null` na PRIMEIRA visita ao nó de laço — é assim que o motor
 * distingue "estou entrando no laço" de "voltei do corpo". Mesmo protocolo de
 * duas visitas que `logic.wait` já usa com `esperaEmCurso`, e pela mesma razão:
 * quem sabe em que ponto está é a frente, não o motor.
 *
 * O teto é aplicado aqui e não na config porque `items.length` só existe em
 * runtime — uma lista que veio de uma resposta de API pode ter mil itens, e o
 * `max` declarado no nó é o que impede isso de virar mil chamadas pagas.
 */
export function proximoPassoDoLaco(input: {
  indiceAtual: number | null;
  totalDeItens: number;
  max: number;
}): PassoDoLaco {
  const teto = Math.min(input.totalDeItens, Math.max(0, input.max));
  const proximo = input.indiceAtual === null ? 0 : input.indiceAtual + 1;
  if (proximo >= teto) return { kind: "fim" };
  return { kind: "corpo", indice: proximo, total: teto };
}

// ──────────────────────── o escopo que a frente vê ───────────────────────────

/** O recorte de `EscopoDeVariaveis` que vem da frente. */
export function escopoDaFrente(frente: FrenteRow): EscopoDaFrente {
  return {
    vars: frente.vars,
    loop_index: frente.loop_index,
    loop_total: frente.loop_total,
  };
}

/**
 * Onde uma escrita de `vars` deve cair: no espaço da execução, ou no da frente.
 *
 * ⚠️ ESTA FUNÇÃO É O PARALELO CORRETO, em uma linha.
 *
 * Fora de um fork há uma frente só, e o espaço compartilhado da execução é o
 * lugar certo — é o que faz `{{vars.dono_escolhido}}` continuar funcionando
 * como sempre funcionou, e é o que os 20 casos de `engine.test.ts` exercitam.
 *
 * Dentro de um fork, dois ramos gravando a mesma chave no espaço compartilhado
 * produziriam o valor de quem terminou por último. Não daria erro: o fluxo
 * seguiria, entregando o resultado errado. Por isso a frente nascida de fork
 * escreve no espaço dela.
 */
export function ondeGravar(frente: FrenteRow): "execucao" | "frente" {
  return frente.fork_node_id === null ? "execucao" : "frente";
}

// ─────────────────────── a espera por evento ─────────────────────────────────

/**
 * Este evento acorda esta frente?
 *
 * `match` é comparação rasa de igualdade sobre o payload — de propósito. A
 * alternativa seria reusar o avaliador de `condicoes.ts`, que é bem mais
 * expressivo; mas ele avalia contra o ESCOPO da execução, e aqui a pergunta é
 * sobre um payload que ainda não entrou em escopo nenhum. Igualdade rasa cobre
 * o caso real ("a resposta daquela conversa", "o pagamento daquele pedido") sem
 * abrir uma segunda linguagem de condição no produto.
 *
 * `match` ausente ou vazio = qualquer evento daquele tipo serve.
 */
export function eventoAcordaAFrente(input: {
  frente: Pick<FrenteRow, "awaiting_event_type" | "awaiting_match">;
  eventType: string;
  payload: Record<string, unknown>;
}): boolean {
  const { frente } = input;
  if (frente.awaiting_event_type === null) return false;
  if (frente.awaiting_event_type !== input.eventType) return false;
  const filtro = frente.awaiting_match;
  if (filtro === null || Object.keys(filtro).length === 0) return true;
  return Object.entries(filtro).every(
    ([chave, valor]) => igualRaso(input.payload[chave], valor),
  );
}

/**
 * Igualdade rasa que não mente sobre tipo.
 *
 * `String(a) === String(b)` seria mais permissivo e faria `1` casar com `"1"` —
 * conveniente até o dia em que um id numérico casa com um id textual de outra
 * entidade. Aqui só valores primitivos casam, e cada um com o próprio tipo.
 */
function igualRaso(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "object" || typeof b === "object") return false;
  return a === b;
}
