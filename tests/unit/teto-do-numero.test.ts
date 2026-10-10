/**
 * A IDADE DO NÚMERO TEM UMA REGRA SÓ — e ela não deixa número antigo em 20/dia.
 *
 * `ativacaoEfetiva` decide de quando conta a idade para o aquecimento: a data
 * declarada na tela de Proteção de envio, senão a criação da conexão. Motor
 * (`loadChannelKnobs`), automação/disparo (`configDePacingDoCanal`) e tela
 * (`knobsView`) passam por ela — antes cada um lia a coluna do seu jeito, e sem
 * linha em `channel_knobs` os três diziam "idade 0" para sempre.
 *
 * O caminho do banco (o turno adiado, o aviso na Central) é medido contra
 * Postgres real em `tests/invariants/teto-do-numero-adia-e-avisa.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { ativacaoEfetiva } from "@/lib/agent-engine/pacing/engine";
import { vetoDeTetoDoNumero } from "@/lib/agent-engine/agent/teto-do-numero";
import { idadeEmDias, knobsView, type ChannelKnobsRow } from "@/lib/ai/pacing-knobs";
import { configDePacingDoCanal } from "@/lib/automation/janela-do-canal";

const AGORA = new Date("2026-07-28T18:00:00Z");
const HA_40_DIAS = "2026-06-18T18:00:00.000Z";
const HA_100_DIAS = "2026-04-19T18:00:00.000Z";

const SEM_DATA: ChannelKnobsRow = {
  throttle_ms: null,
  jitter_max_ms: null,
  window_start_hour: null,
  window_end_hour: null,
  allow_sunday: null,
  timezone: null,
  warmup_daily_caps: null,
  number_activated_at: null,
};

describe("ativacaoEfetiva — de quando conta a idade", () => {
  it("a data declarada vence a criação da conexão", () => {
    expect(ativacaoEfetiva(HA_100_DIAS, HA_40_DIAS)?.toISOString()).toBe(HA_100_DIAS);
  });

  it("sem data declarada, conta da criação da conexão", () => {
    expect(ativacaoEfetiva(null, HA_40_DIAS)?.toISOString()).toBe(HA_40_DIAS);
    expect(ativacaoEfetiva(undefined, new Date(HA_40_DIAS))?.toISOString()).toBe(HA_40_DIAS);
  });

  it("sem nenhuma das duas, null — o motor fica no degrau conservador", () => {
    expect(ativacaoEfetiva(null, null)).toBeNull();
  });

  it("data ilegível é ignorada, não vira 'Invalid Date' no cálculo da idade", () => {
    expect(ativacaoEfetiva("não é data", HA_40_DIAS)?.toISOString()).toBe(HA_40_DIAS);
  });
});

describe("a tela diz a mesma idade que o motor aplica", () => {
  it("sem data declarada, a idade vem da conexão e a tela diz de onde", () => {
    expect(idadeEmDias(SEM_DATA, AGORA, HA_40_DIAS)).toBe(40);
    const view = knobsView(null, AGORA, HA_40_DIAS);
    expect(view.warmup.age_days).toBe(40);
    expect(view.warmup.age_from).toBe("conexao");
    // 40 dias passa do último degrau (31): sem teto de aquecimento.
    expect(view.warmup.cap_today).toBeNull();
  });

  it("com data declarada, a tela diz que veio dela", () => {
    const view = knobsView({ ...SEM_DATA, number_activated_at: HA_100_DIAS }, AGORA, HA_40_DIAS);
    expect(view.warmup.age_days).toBe(100);
    expect(view.warmup.age_from).toBe("declarada");
  });
});

/** Duplo do Supabase que responde por TABELA — a automação lê duas. */
function admin(porTabela: Record<string, unknown>) {
  return {
    from: (tabela: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: porTabela[tabela] ?? null, error: null }),
      };
      return chain;
    },
  } as never;
}

describe("automação e disparo em massa usam a mesma idade", () => {
  it("sem linha em channel_knobs, a idade conta da criação da conexão", async () => {
    const cfg = await configDePacingDoCanal(
      admin({ channel_sessions: { created_at: HA_40_DIAS } }),
      "org",
      "canal",
    );
    expect(cfg.numberActivatedAt?.toISOString()).toBe(HA_40_DIAS);
  });

  it("linha de knobs com data declarada não pergunta pela conexão", async () => {
    const cfg = await configDePacingDoCanal(
      admin({
        channel_knobs: { ...SEM_DATA, number_activated_at: HA_100_DIAS },
        channel_sessions: { created_at: HA_40_DIAS },
      }),
      "org",
      "canal",
    );
    expect(cfg.numberActivatedAt?.toISOString()).toBe(HA_100_DIAS);
  });
});

describe("vetoDeTetoDoNumero — só o teto do dia adia o turno", () => {
  const abertura = new Date("2026-07-29T10:00:00Z");

  it("reconhece o teto de aquecimento e o teto diário", () => {
    expect(vetoDeTetoDoNumero({ code: "warmup_cap", message: "m", nextAllowedAt: abertura })).toEqual({
      code: "warmup_cap",
      nextAllowedAt: abertura,
      reason: "m",
    });
    expect(vetoDeTetoDoNumero({ code: "daily_cap", message: "m", nextAllowedAt: abertura })?.code).toBe(
      "daily_cap",
    );
  });

  it("outros vetos seguem como erro de ensino ao modelo", () => {
    expect(vetoDeTetoDoNumero({ code: "spinning", message: "m", nextAllowedAt: abertura })).toBeNull();
    expect(vetoDeTetoDoNumero({ code: "outside_window", message: "m", nextAllowedAt: abertura })).toBeNull();
    // Sem abertura não há para quando adiar.
    expect(vetoDeTetoDoNumero({ code: "warmup_cap", message: "m" })).toBeNull();
  });
});
