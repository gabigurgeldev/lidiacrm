/**
 * O TESTE QUE PROTEGE O NÚMERO DO CLIENTE.
 *
 * Nos DOIS sentidos, de propósito: pedir mais devagar tem de funcionar (senão o
 * controle é decorativo) e pedir mais rápido NÃO pode funcionar (senão o
 * anti-ban é decorativo). Um teste que só medisse um dos lados deixaria passar
 * a correção óbvia e errada — "deixa o interval_ms mandar" — que é a que alguém
 * vai tentar quando reclamarem que o disparo demora.
 */
import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { CHANNEL_CAPABILITIES } from "@/lib/channels/capabilities";
import { intervaloEfetivo, pisoDoIntervalo } from "@/lib/bulk-send/ritmo";

/**
 * As duas capabilities de que este teste precisa, escolhidas pela FORMA e não
 * pelo nome do canal.
 *
 * Não é preciosismo: `scripts/lint-channels.ts` proíbe nome de provider fora de
 * `lib/channels/`, e este arquivo mora em `lib/bulk-send/`. Mas a razão é a
 * mesma da doutrina — `intervaloEfetivo` não sabe COM QUEM se fala, sabe o que
 * o canal permite. Um teste que dissesse "no canal tal acontece X" estaria
 * afirmando mais do que a função faz, e quebraria no dia em que a matriz
 * mudasse de nome sem mudar de comportamento.
 *
 * Os dados são os REAIS da matriz — não objetos inventados. Se um dia nenhum
 * canal tiver piso próprio (ou todos tiverem), o `?? ` explode e o teste avisa
 * em vez de medir o vazio.
 */
const TODAS = Object.values(CHANNEL_CAPABILITIES);
/** Canal sem piso próprio de intervalo: quem manda é o throttle do número. */
const QR = TODAS.find((c) => c.minIntervalMs === null)!;
/** Canal com piso próprio (rate limit da plataforma), maior que o do número. */
const OFICIAL = TODAS.find((c) => (c.minIntervalMs ?? 0) > PACING_DEFAULTS.throttleMs)!;

/** Jitter determinístico: zero, para as contas serem exatas. */
const semJitter = () => 0;

describe("intervaloEfetivo — o operador pode ir mais devagar", () => {
  it("respeita o intervalo escolhido quando ele é MAIOR que o piso", () => {
    const r = intervaloEfetivo({
      intervaloDoOperador: 30_000,
      knobs: PACING_DEFAULTS, // throttle 1200
      capabilities: QR, // minIntervalMs null
      rng: semJitter,
    });
    expect(r.intervaloMs).toBe(30_000);
    expect(r.origemDoPiso).toBe("operador");
  });

  it("respeita o intervalo escolhido mesmo acima do piso do canal oficial", () => {
    const r = intervaloEfetivo({
      intervaloDoOperador: 20_000,
      knobs: PACING_DEFAULTS,
      capabilities: OFICIAL, // minIntervalMs 6000
      rng: semJitter,
    });
    expect(r.intervaloMs).toBe(20_000);
  });
});

describe("intervaloEfetivo — o operador NUNCA vai mais rápido", () => {
  it("um pedido de 100ms num número por QR vira o throttle do número", () => {
    const r = intervaloEfetivo({
      intervaloDoOperador: 100,
      knobs: PACING_DEFAULTS,
      capabilities: QR,
      rng: semJitter,
    });
    expect(r.intervaloMs).toBe(PACING_DEFAULTS.throttleMs);
    expect(r.origemDoPiso).toBe("numero");
  });

  it("um pedido de 1s no canal oficial vira o piso do canal, que é maior", () => {
    const r = intervaloEfetivo({
      intervaloDoOperador: 1_000,
      knobs: PACING_DEFAULTS,
      capabilities: OFICIAL,
      rng: semJitter,
    });
    expect(r.intervaloMs).toBe(OFICIAL.minIntervalMs);
    expect(r.origemDoPiso).toBe("canal");
  });

  it("zero e negativo caem no piso, nunca em rajada", () => {
    for (const pedido of [0, -1, -999_999]) {
      const r = intervaloEfetivo({
        intervaloDoOperador: pedido,
        knobs: PACING_DEFAULTS,
        capabilities: QR,
        rng: semJitter,
      });
      expect(r.intervaloMs).toBe(PACING_DEFAULTS.throttleMs);
    }
  });

  it("o throttle do NÚMERO manda quando o operador o afrouxou em Conexões", () => {
    // Quem editou os knobs para 10s espera 10s, mesmo pedindo 2s na campanha.
    const knobsLentos = { ...PACING_DEFAULTS, throttleMs: 10_000 };
    const r = intervaloEfetivo({
      intervaloDoOperador: 2_000,
      knobs: knobsLentos,
      capabilities: QR,
      rng: semJitter,
    });
    expect(r.intervaloMs).toBe(10_000);
  });
});

describe("jitter", () => {
  it("é somado, nunca subtraído — o resultado nunca fica abaixo do piso", () => {
    // rng no extremo alto e no extremo baixo; em ambos o gap >= piso.
    for (const rng of [() => 0, () => 0.999999]) {
      const r = intervaloEfetivo({
        intervaloDoOperador: 0,
        knobs: PACING_DEFAULTS,
        capabilities: QR,
        rng,
      });
      expect(r.intervaloMs).toBeGreaterThanOrEqual(PACING_DEFAULTS.throttleMs);
      expect(r.intervaloMs).toBeLessThanOrEqual(
        PACING_DEFAULTS.throttleMs + PACING_DEFAULTS.jitterMaxMs,
      );
    }
  });

  it("usa a amplitude dos knobs do número, não um segundo número próprio", () => {
    const knobs = { ...PACING_DEFAULTS, jitterMaxMs: 5_000 };
    const r = intervaloEfetivo({
      intervaloDoOperador: 0,
      knobs,
      capabilities: QR,
      rng: () => 0.999999,
    });
    expect(r.intervaloMs).toBe(PACING_DEFAULTS.throttleMs + 5_000);
  });
});

describe("pisoDoIntervalo — o número que a TELA mostra", () => {
  it("no QR é o throttle do número", () => {
    expect(pisoDoIntervalo(PACING_DEFAULTS, QR)).toEqual({
      pisoMs: PACING_DEFAULTS.throttleMs,
      origem: "numero",
    });
  });

  it("no canal oficial é o piso do canal, porque é maior", () => {
    expect(pisoDoIntervalo(PACING_DEFAULTS, OFICIAL)).toEqual({
      pisoMs: OFICIAL.minIntervalMs,
      origem: "canal",
    });
  });

  it("empate vai para o número — é o piso que o operador consegue mexer", () => {
    const knobs = { ...PACING_DEFAULTS, throttleMs: OFICIAL.minIntervalMs as number };
    expect(pisoDoIntervalo(knobs, OFICIAL).origem).toBe("numero");
  });

  it("knobs mais lentos que o canal vencem o canal", () => {
    const knobs = { ...PACING_DEFAULTS, throttleMs: 30_000 };
    expect(pisoDoIntervalo(knobs, OFICIAL)).toEqual({ pisoMs: 30_000, origem: "numero" });
  });
});
