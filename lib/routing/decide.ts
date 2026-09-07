/**
 * Decisão PURA de roteamento (G5-02 — AT-03, spec 13 §5).
 *
 * Toda a lógica de branch do worker vive aqui, sem DB e sem relógio implícito
 * (o `now` é injetado). O worker (lib/routing/worker.ts) é só a casca de I/O:
 * junta os inputs (mode, conversa, elegíveis, config), chama `decideRouting` e
 * executa a Action. Isso mantém as 5 regras do acceptance testáveis por unit
 * sem precisar de um Postgres vivo.
 */
import type { RoutingConfig, RoutingMode } from "@/lib/schemas/routing";

/** Um atendente já FILTRADO por elegibilidade (§5: disponível ∧ horário ∧ folga). */
export interface RoutingCandidate {
  userId: string;
  /** Conversas abertas atribuídas (carga atual) — desempate no modo round_robin. */
  currentLoad: number;
  /** Epoch ms da última atribuição recebida; null = nunca (prioridade máxima no rodízio). */
  lastAssignedAt: number | null;
}

export type RoutingAction =
  | { kind: "assign"; userId: string }
  /** Marca o evento consumido sem atribuir (já tem dono, modo manual, modo não suportado). */
  | { kind: "skip"; reason: string }
  /** Sem elegível: reenfileira com backoff (fica na fila até haver quem atenda). */
  | { kind: "requeue"; nextAttemptAt: string; attempts: number }
  /** Estourou max_retries sem elegível: desiste do evento; conversa fica na fila (G5-03 mostra). */
  | { kind: "dead"; reason: string };

export interface DecideRoutingInput {
  mode: RoutingMode | string;
  /** A conversa já tem dono? true ⇒ replay/corrida ⇒ nunca reatribui (idempotência AT-03). */
  alreadyAssigned: boolean;
  /** Atendentes JÁ elegíveis (o worker aplicou isAttendantEligible). */
  eligibles: RoutingCandidate[];
  config: RoutingConfig;
  /** attempts atual do event_log (antes deste processamento). */
  attempts: number;
  now: Date;
}

/**
 * Rodízio real (não random): entre elegíveis, o que recebeu atribuição há mais
 * tempo (ou nunca) vem primeiro; desempate determinístico por userId. Deriva o
 * "último atribuído" de conversation_assignment_events — sem coluna de estado.
 */
export function selectRoundRobin(eligibles: RoutingCandidate[]): string | null {
  if (eligibles.length === 0) return null;
  const sorted = [...eligibles].sort((a, b) => {
    const la = a.lastAssignedAt ?? -1;
    const lb = b.lastAssignedAt ?? -1;
    if (la !== lb) return la - lb; // mais antigo (ou nunca = -1) primeiro
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return sorted[0]?.userId ?? null;
}

/**
 * Sorteio entre os elegíveis.
 *
 * ⚠️ NÃO é rodízio, e a diferença é o ponto: `selectRoundRobin` distribui por
 * JUSTIÇA (quem está há mais tempo sem receber vem primeiro) e o sorteio
 * distribui por ACASO. Numa equipe pequena o acaso concentra — três leads
 * seguidos para a mesma pessoa é resultado comum, não defeito. Quem escolhe
 * este bloco está pedindo imprevisibilidade de propósito (evitar que o time
 * saiba de quem é a vez); quem quer divisão pareja usa o rodízio.
 *
 * `rng` é injetável para o teste medir a distribuição sem depender de sorte.
 */
export function selectRandom(
  eligibles: RoutingCandidate[],
  rng: () => number = Math.random,
): string | null {
  if (eligibles.length === 0) return null;
  // Ordem estável antes de sortear: `eligibles` chega na ordem do banco, e um
  // sorteio sobre ordem instável é irreproduzível mesmo com `rng` fixo.
  const ordenados = [...eligibles].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.floor(rng() * ordenados.length)));
  return ordenados[i]?.userId ?? null;
}

/**
 * A "fila indiana": uma ORDEM declarada por quem monta o fluxo, percorrida em
 * volta.
 *
 * ⚠️ Também não é rodízio. O rodízio decide pela fila do sistema (quem recebeu
 * há mais tempo); aqui a ordem é a que a pessoa escreveu, e ela vale mesmo que
 * seja "injusta" — é comum o time ter uma ordem combinada que o sistema não
 * conhece (quem é sênior atende primeiro, quem entrou ontem atende por último).
 *
 * `cursor` é a posição de onde continuar, guardada FORA da execução: cada lead
 * é uma execução nova, e um cursor por execução recomeçaria do zero toda vez —
 * o que faria a "ordem" entregar sempre ao primeiro da lista.
 *
 * Quem está na ordem mas não está elegível agora é PULADO, e o cursor avança
 * mesmo assim: parar a fila porque o terceiro da lista saiu para almoçar
 * seguraria todos os leads seguintes atrás dele.
 */
export function selectFixedOrder(
  ordem: readonly string[],
  eligibles: RoutingCandidate[],
  cursor: number,
): { userId: string | null; proximoCursor: number } {
  if (ordem.length === 0) return { userId: null, proximoCursor: cursor };
  const elegiveis = new Set(eligibles.map((e) => e.userId));

  for (let passo = 0; passo < ordem.length; passo += 1) {
    const i = (cursor + passo) % ordem.length;
    const candidato = ordem[i];
    if (candidato !== undefined && elegiveis.has(candidato)) {
      return { userId: candidato, proximoCursor: (i + 1) % ordem.length };
    }
  }
  // Ninguém da ordem está elegível. O cursor NÃO anda: quando alguém voltar, a
  // vez é de quem estava na vez, e não de quem o relógio calhou de alcançar.
  return { userId: null, proximoCursor: cursor };
}


export function decideRouting(input: DecideRoutingInput): RoutingAction {
  // Idempotência (acceptance 3): conversa que já ganhou dono não é reatribuída.
  if (input.alreadyAssigned) return { kind: "skip", reason: "already_assigned" };

  // Modo manual (acceptance 5): worker não roteia.
  if (input.mode === "manual") return { kind: "skip", reason: "manual_mode" };

  // 'load' é INALCANÇÁVEL: routingConfigSchema só permite manual|round_robin
  // (G5-01). Tratado defensivamente como no-op (post-MVP), nunca dead code real.
  if (input.mode !== "round_robin") return { kind: "skip", reason: `unsupported_mode:${input.mode}` };

  const picked = selectRoundRobin(input.eligibles);
  if (picked) return { kind: "assign", userId: picked };

  // Sem elegível (acceptance 4): re-agenda com backoff da config (não hardcoded).
  const nextAttempts = input.attempts + 1;
  if (nextAttempts > input.config.max_retries) {
    return { kind: "dead", reason: "max_retries_no_eligible" };
  }
  const nextAttemptAt = new Date(input.now.getTime() + input.config.backoff_seconds * 1000).toISOString();
  return { kind: "requeue", nextAttemptAt, attempts: nextAttempts };
}
