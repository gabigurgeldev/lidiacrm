/**
 * O RITMO REAL DE UM DISPARO — a linha que protege o número do cliente.
 *
 * ═══ A regra, em uma frase ═══
 *
 * O operador pode ir mais DEVAGAR que o anti-ban. Nunca mais rápido.
 *
 * Três réguas chegam aqui e a maior vence:
 *
 *   1. `interval_ms` da campanha — a vontade do operador, escolhida na tela.
 *   2. `knobs.throttleMs` — o anti-ban DESTE número (`channel_knobs`, editável
 *      em Conexões; default 1200ms).
 *   3. `capabilities.minIntervalMs` — o piso DESTE canal (6000ms no canal
 *      oficial e no BSP, por conta do rate limit da plataforma; `null` no QR,
 *      onde não há teto declarado e quem manda é o item 2).
 *
 * ═══ Por que isto é um módulo, e não um `Math.max` dentro do motor ═══
 *
 * Porque é a otimização que alguém vai tentar primeiro. "O cliente reclamou que
 * o disparo demora" tem uma correção óbvia e errada — deixar o `interval_ms`
 * mandar — e ela some no meio de um laço de 200 linhas. Aqui ela tem nome,
 * arquivo e um teste que a exercita nos DOIS sentidos (`bulk-send-ritmo.test.ts`):
 * pedir mais devagar funciona, pedir mais rápido não.
 *
 * ═══ O jitter ═══
 *
 * Somado por fora, nunca subtraído: o intervalo efetivo é sempre >= o piso. Um
 * jitter que pudesse encurtar o gap desfaria justamente o que o piso garante.
 * A amplitude é `knobs.jitterMaxMs`, a mesma do `decidePacing` — não há um
 * segundo número de jitter no produto.
 *
 * ⚠️ Isto NÃO substitui `decidePacing()`. Ele decide se PODE enviar (janela
 * horária, warm-up, cap diário) e devolve `waitMs` para o throttle; este módulo
 * decide o ESPAÇAMENTO entre dois envios da mesma campanha. Os dois compõem, e
 * o motor aplica `Math.max` entre o `waitMs` dele e o intervalo daqui.
 */
import type { PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import type { ChannelCapabilities } from "@/lib/channels/capabilities";

export interface EntradaDeRitmo {
  /** `bulk_sends.interval_ms` — a escolha do operador. */
  intervaloDoOperador: number;
  /** Knobs efetivos do número (`configDePacingDoCanal`). */
  knobs: PacingKnobs;
  /** Capability do canal (`capabilitiesOf(provider)`). */
  capabilities: ChannelCapabilities;
  /** [0,1) — injetável nos testes; default `Math.random`. */
  rng?: () => number;
}

export interface Ritmo {
  /** O espaçamento a aplicar, já com jitter. */
  intervaloMs: number;
  /** O piso que venceu, SEM jitter — é o que a tela mostra ao operador. */
  pisoMs: number;
  /** Quem determinou o piso. A tela usa isto para explicar por que travou. */
  origemDoPiso: "operador" | "numero" | "canal";
}

/**
 * O piso, sem jitter. Separado porque a TELA precisa dele: o campo de intervalo
 * do wizard trava abaixo deste valor e diz de onde ele veio. Uma segunda cópia
 * da conta na UI faria a tela prometer um número e o motor aplicar outro — que
 * é exatamente o que o comentário de `warmupCapFor` manda evitar.
 */
export function pisoDoIntervalo(
  knobs: PacingKnobs,
  capabilities: ChannelCapabilities,
): { pisoMs: number; origem: "numero" | "canal" } {
  const doCanal = capabilities.minIntervalMs ?? 0;
  // Empate vai para `numero`: é o piso que o operador CONSEGUE mexer (Conexões),
  // e mandá-lo ao canal ofereceria uma tela que não muda nada.
  return doCanal > knobs.throttleMs
    ? { pisoMs: doCanal, origem: "canal" }
    : { pisoMs: knobs.throttleMs, origem: "numero" };
}

export function intervaloEfetivo(entrada: EntradaDeRitmo): Ritmo {
  const rng = entrada.rng ?? Math.random;
  const { pisoMs, origem } = pisoDoIntervalo(entrada.knobs, entrada.capabilities);

  // Clamp em >= 0 antes de comparar: um `interval_ms` negativo (linha legada,
  // escritor externo, banco de clone sem o CHECK) não pode virar o maior por
  // acidente de sinal nem arrastar o resultado para baixo do piso.
  const doOperador = Math.max(0, entrada.intervaloDoOperador);

  const venceuOOperador = doOperador > pisoMs;
  const base = venceuOOperador ? doOperador : pisoMs;

  // Jitter SOMADO, nunca subtraído — ver o cabeçalho.
  const jitter = Math.floor(rng() * (Math.max(0, entrada.knobs.jitterMaxMs) + 1));

  return {
    intervaloMs: base + jitter,
    pisoMs,
    origemDoPiso: venceuOOperador ? "operador" : origem,
  };
}
