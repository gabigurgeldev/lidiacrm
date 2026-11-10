import { describe, expect, it, vi } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { enviarEmLote, intervaloEntreEnvios, juntarAoLote, LIMITE_DO_LOTE } from "./enviar-lote";

const arquivo = (n: string) => new File(["x"], n, { type: "image/jpeg" });

describe("juntarAoLote", () => {
  it("junta até o teto e conta o excedente", () => {
    const atuais = Array.from({ length: 8 }, (_, i) => arquivo(`a${i}`));
    const novos = Array.from({ length: 5 }, (_, i) => arquivo(`n${i}`));
    const { arquivos, descartados } = juntarAoLote(atuais, novos);
    expect(arquivos).toHaveLength(LIMITE_DO_LOTE);
    expect(arquivos.slice(8).map((f) => f.name)).toEqual(["n0", "n1"]);
    expect(descartados).toBe(3);
  });

  it("lote cheio não aceita mais nada", () => {
    const cheio = Array.from({ length: LIMITE_DO_LOTE }, (_, i) => arquivo(`a${i}`));
    expect(juntarAoLote(cheio, [arquivo("x")])).toMatchObject({ descartados: 1 });
  });
});

describe("intervaloEntreEnvios", () => {
  it("é o piso do motor anti-ban mais um jitter limitado", () => {
    expect(intervaloEntreEnvios(() => 0)).toBe(PACING_DEFAULTS.throttleMs);
    expect(intervaloEntreEnvios(() => 0.999)).toBeLessThan(
      PACING_DEFAULTS.throttleMs + PACING_DEFAULTS.jitterMaxMs,
    );
  });
});

describe("enviarEmLote", () => {
  it("envia em sequência, espera ENTRE os envios (nunca antes do primeiro)", async () => {
    const linha: string[] = [];
    const esperar = vi.fn(async (ms: number) => {
      linha.push(`espera:${ms}`);
    });
    const r = await enviarEmLote(
      ["a", "b", "c"],
      async (item) => {
        linha.push(`envia:${item}`);
      },
      { esperar, sortear: () => 0 },
    );
    expect(r).toEqual({ enviados: 3 });
    const t = PACING_DEFAULTS.throttleMs;
    expect(linha).toEqual(["envia:a", `espera:${t}`, "envia:b", `espera:${t}`, "envia:c"]);
  });

  it("não começa o próximo antes de o anterior terminar", async () => {
    let emCurso = 0;
    let pico = 0;
    await enviarEmLote(
      [1, 2, 3],
      async () => {
        emCurso++;
        pico = Math.max(pico, emCurso);
        await Promise.resolve();
        emCurso--;
      },
      { esperar: async () => {} },
    );
    expect(pico).toBe(1);
  });

  it("para no primeiro erro e diz quantos saíram — os seguintes nem são tentados", async () => {
    const enviar = vi.fn(async (item: string) => {
      if (item === "b") throw new Error("falhou");
    });
    const r = await enviarEmLote(["a", "b", "c"], enviar, { esperar: async () => {} });
    expect(r.enviados).toBe(1);
    expect((r.erro as Error).message).toBe("falhou");
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it("informa o progresso", async () => {
    const progresso: Array<[number, number]> = [];
    await enviarEmLote(["a", "b"], async () => {}, {
      esperar: async () => {},
      onProgresso: (f, t) => progresso.push([f, t]),
    });
    expect(progresso).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});
