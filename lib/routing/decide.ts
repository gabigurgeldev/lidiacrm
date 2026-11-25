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
  /**
   * Sem elegível: reenfileira (fica na fila até haver quem atenda).
   * `aguardandoHorario` = a volta foi marcada para a abertura de uma janela, e
   * a tentativa NÃO foi gasta — ver `nextOpeningAt` em `DecideRoutingInput`.
   */
  | {
      kind: "requeue";
      nextAttemptAt: string;
      attempts: number;
      aguardandoHorario?: true;
      /**
       * As tentativas rápidas (`max_retries`) acabaram e o evento passou a
       * conferir a fila devagar — ver `ESPERA_NA_FILA_SEGUNDOS`. Não existe mais
       * "desistir": a conversa sem dono espera até alguém poder recebê-la.
       */
      naFila?: true;
    };

/**
 * De quanto em quanto tempo o rodízio confere de novo uma conversa que esgotou
 * as tentativas rápidas sem ninguém para recebê-la.
 *
 * ## Por que existe, e por que o evento não morre mais
 *
 * Até aqui, `max_retries` × `backoff_seconds` sem elegível matava o evento
 * (`status = 'dead'`) — e evento morto nunca é reavaliado. A conversa ficava sem
 * dono PARA SEMPRE, mesmo depois de a equipe voltar. Com a visibilidade "só as
 * minhas" (`visibility_mode = 'own'`), conversa sem dono não aparece para
 * atendente nenhuma: o cliente escreveu e ninguém nunca viu.
 *
 * Medido em produção (Faby Flores, 2026-11-25): 248 eventos mortos em três
 * episódios que nada tinham a ver um com o outro — ninguém marcado disponível
 * (04–06/11), as duas atendentes no teto de capacidade 30 (10–21/11) e "Sempre
 * disponível" desligado, com o cron de sinal de vida tirando as duas do ar
 * (23–25/11). Cada episódio foi corrigido na configuração; nenhum devolveu as
 * conversas, porque os eventos delas já estavam mortos — 214 seguiam sem dono.
 *
 * Ninguém disponível, todo mundo lotado ou offline são estados sem hora marcada
 * para acabar (o fora-do-horário tem hora, e é tratado por `nextOpeningAt`).
 * Então o evento continua na fila e confere a cada `ESPERA_NA_FILA_SEGUNDOS`.
 * Ele termina sozinho quando a conversa deixa de estar na fila: ganhou dono
 * (`already_assigned`), foi encerrada (`skipped_not_queued`), sumiu
 * (`skipped_conv_missing`) ou a organização voltou para o modo manual.
 *
 * 10 min é o atraso máximo entre a equipe voltar e a conversa chegar a ela. O
 * custo é ~4 leituras por conversa parada a cada 10 min. Nunca confere mais
 * rápido que o `backoff_seconds` configurado: quem pediu calma, tem calma.
 */
export const ESPERA_NA_FILA_SEGUNDOS = 600;

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
  /**
   * Quando alguém disponível e com folga entra no horário (`loadRoutingPool`).
   * Sem elegível e com abertura marcada, o evento volta NA abertura e não gasta
   * tentativa: fora do horário é espera com fim conhecido, não falha. Ausente ou
   * `null` = o caminho antigo, backoff + tentativa.
   */
  nextOpeningAt?: Date | null;
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

  // Sem elegível porque é almoço, noite ou antes do expediente: volta quando a
  // primeira janela abrir, sem contar tentativa. Sem isto, a conversa que chega
  // fora do horário cairia na conferência lenta e esperaria até 10 min depois
  // da abertura; com isto, ela chega no minuto em que a jornada começa.
  const abre = input.nextOpeningAt ?? null;
  if (abre !== null && abre.getTime() > input.now.getTime()) {
    return {
      kind: "requeue",
      nextAttemptAt: abre.toISOString(),
      attempts: input.attempts,
      aguardandoHorario: true,
    };
  }

  // Sem elegível (acceptance 4): re-agenda com backoff da config (não hardcoded).
  const nextAttempts = input.attempts + 1;
  if (nextAttempts > input.config.max_retries) {
    // Esgotou as tentativas rápidas: segue na fila, conferindo devagar. NÃO
    // desiste — ver `ESPERA_NA_FILA_SEGUNDOS`.
    const segundos = Math.max(input.config.backoff_seconds, ESPERA_NA_FILA_SEGUNDOS);
    return {
      kind: "requeue",
      nextAttemptAt: new Date(input.now.getTime() + segundos * 1000).toISOString(),
      attempts: nextAttempts,
      naFila: true,
    };
  }
  const nextAttemptAt = new Date(input.now.getTime() + input.config.backoff_seconds * 1000).toISOString();
  return { kind: "requeue", nextAttemptAt, attempts: nextAttempts };
}
