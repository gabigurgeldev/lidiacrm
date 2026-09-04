/**
 * O bloco "Esperar" passou a aceitar SEGUNDOS.
 *
 * O piso era de 5 minutos, e a razão estava escrita no código: "menos que isso
 * o relógio do worker (1×/min) não distingue". Era verdade — uma espera de 10s
 * seria arredondada para até 60s pelo cron, ou seja, mentira na tela.
 *
 * `lib/flow-engine/loop.ts` derrubou esse relógio (retomada de ~2s), então o
 * piso caiu para 10s. Este arquivo prende as duas pontas: o que passou a ser
 * aceito, e o que continua recusado — inclusive o motivo de o piso não ser 1s.
 */
import { describe, expect, it } from "vitest";

import { waitConfigSchema } from "@/lib/flow-engine/nodes/logica";
import { melhorUnidade } from "@/app/app/flows/[id]/_components/forms/LogicWaitForm";

describe("o piso da espera", () => {
  it("⭐ aceita 10 segundos — era recusado antes do laço existir", () => {
    expect(waitConfigSchema.safeParse({ duracao_ms: 10_000 }).success).toBe(true);
  });

  it("⭐ recusa abaixo de 10s: sob a cadência do laço (~2s) o número vira ficção", () => {
    expect(waitConfigSchema.safeParse({ duracao_ms: 1_000 }).success).toBe(false);
    expect(waitConfigSchema.safeParse({ duracao_ms: 9_999 }).success).toBe(false);
  });

  it("os 5 minutos de antes continuam válidos — baixar um piso não quebra fluxo publicado", () => {
    expect(waitConfigSchema.safeParse({ duracao_ms: 300_000 }).success).toBe(true);
  });

  it("o teto de 90 dias continua de pé", () => {
    const noventaDias = 90 * 86_400_000;
    expect(waitConfigSchema.safeParse({ duracao_ms: noventaDias }).success).toBe(true);
    expect(waitConfigSchema.safeParse({ duracao_ms: noventaDias + 1 }).success).toBe(false);
  });
});

describe("melhorUnidade — o campo reabre como foi escrito", () => {
  it("⭐ 3 dias reabre como dias, não como 4320 minutos", () => {
    // Era preciso digitar `4320` para esperar três dias, e ninguém confere esse
    // número: erra-se por um zero e o fluxo dorme um mês.
    expect(melhorUnidade(3 * 86_400_000)).toBe("dias");
  });

  it("⭐ 30 segundos reabre como segundos", () => {
    expect(melhorUnidade(30_000)).toBe("segundos");
  });

  it("escolhe a maior unidade SEM SOBRA — 90 minutos não é 1 hora", () => {
    expect(melhorUnidade(90 * 60_000)).toBe("minutos");
    expect(melhorUnidade(2 * 3_600_000)).toBe("horas");
  });
});
