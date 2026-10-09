import { describe, expect, it } from "vitest";

import { avaliarLimites, decisorPodeChamar, type TransicaoRecente } from "./limites";
import { MOTIVOS, rotuloDoMotivo } from "./motivos";
import { chaveDoNome, limitesSchema, politicaInicial, politicaSchema } from "./politica/schema";

const AG_A = "11111111-1111-4111-8111-111111111111";
const AG_B = "22222222-2222-4222-8222-222222222222";
const FLUXO = "33333333-3333-4333-8333-333333333333";

describe("política do coordenador", () => {
  it("nasce desligada e sem destinos", () => {
    const p = politicaInicial();
    expect(p.modo).toBe("off");
    expect(p.destinos).toEqual([]);
    expect(p.config.limites.transferencias_por_janela).toBe(4);
  });

  it("aceita uma política válida com regra, padrão e permissões", () => {
    const r = politicaSchema.safeParse({
      modo: "shadow",
      destinos: [
        { chave: "comercial", tipo: "agente", agent_id: AG_A, quando_usar: "Dúvidas sobre planos" },
        { chave: "contratacao", tipo: "fluxo", flow_id: FLUXO, permite_tarefa: true },
      ],
      config: {
        destino_padrao: "comercial",
        regras_de_entrada: [{ id: "contratar", quando: "contem", termos: ["quero contratar"], destino: "contratacao" }],
        permissoes: { comercial: { pode_chamar: ["contratacao"] } },
      },
    });
    expect(r.success).toBe(true);
  });

  it("recusa chave citada que não existe — no padrão, na regra e na permissão", () => {
    const r = politicaSchema.safeParse({
      modo: "active",
      destinos: [{ chave: "comercial", tipo: "agente", agent_id: AG_A }],
      config: {
        destino_padrao: "suporte",
        regras_de_entrada: [{ id: "x", quando: "igual", termos: ["2"], destino: "fantasma" }],
        permissoes: { comercial: { pode_transferir: ["outro"] } },
      },
    });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining(["Destino desconhecido: suporte.", "Destino desconhecido: fantasma.", "Destino desconhecido: outro."]),
    );
  });

  it("recusa destino de agente sem agent_id, ou com os dois alvos", () => {
    expect(politicaSchema.safeParse({ modo: "off", destinos: [{ chave: "a", tipo: "agente" }] }).success).toBe(false);
    expect(
      politicaSchema.safeParse({
        modo: "off",
        destinos: [{ chave: "a", tipo: "agente", agent_id: AG_A, flow_id: FLUXO }],
      }).success,
    ).toBe(false);
  });

  it("recusa chave repetida e destino que não conduz nem faz tarefa", () => {
    expect(
      politicaSchema.safeParse({
        modo: "off",
        destinos: [
          { chave: "a", tipo: "agente", agent_id: AG_A },
          { chave: "a", tipo: "agente", agent_id: AG_B },
        ],
      }).success,
    ).toBe(false);
    expect(
      politicaSchema.safeParse({
        modo: "off",
        destinos: [{ chave: "a", tipo: "agente", agent_id: AG_A, permite_conduzir: false, permite_tarefa: false }],
      }).success,
    ).toBe(false);
  });

  it("campo fora do contrato é recusado, não ignorado", () => {
    expect(politicaSchema.safeParse({ modo: "off", organization_id: AG_A }).success).toBe(false);
  });

  it("chaveDoNome tira acento, normaliza e não colide", () => {
    expect(chaveDoNome("Comercial — Plano Essencial")).toBe("comercial_plano_essencial");
    expect(chaveDoNome("Comercial", new Set(["comercial"]))).toBe("comercial_2");
    expect(chaveDoNome("!!!")).toBe("destino");
  });
});

describe("limites", () => {
  const limites = limitesSchema.parse({});
  const agora = new Date("2026-10-09T12:00:00Z");
  const t = (para_id: string, minutosAtras: number, extra: Partial<TransicaoRecente> = {}): TransicaoRecente => ({
    para_tipo: "agente",
    para_id,
    categoria: "modelo",
    status: "aplicada",
    created_at: new Date(agora.getTime() - minutosAtras * 60_000).toISOString(),
    ...extra,
  });

  it("dentro do limite: segue", () => {
    expect(
      avaliarLimites({ recentes: [t(AG_A, 5)], limites, agora, proposta: { para_tipo: "agente", para_id: AG_B, categoria: "modelo" } }),
    ).toEqual({ ok: true });
  });

  it("transferências demais na janela: barra", () => {
    const recentes = [t(AG_A, 1), t(AG_B, 2), t(AG_A, 3), t(FLUXO, 4, { para_tipo: "fluxo" })];
    expect(
      avaliarLimites({ recentes, limites, agora, proposta: { para_tipo: "agente", para_id: AG_B, categoria: "modelo" } }),
    ).toEqual({ ok: false, motivo: "transferencias_demais" });
  });

  it("fora da janela não conta", () => {
    const recentes = [t(AG_A, 60), t(AG_B, 61), t(AG_A, 62), t(AG_B, 63)];
    expect(
      avaliarLimites({ recentes, limites, agora, proposta: { para_tipo: "agente", para_id: AG_A, categoria: "modelo" } }).ok,
    ).toBe(true);
  });

  it("retorno de chamada nunca é barrado pela contagem — o ciclo A→B→A legítimo", () => {
    const recentes = [t(AG_A, 1), t(FLUXO, 2, { para_tipo: "fluxo" }), t(AG_A, 3), t(FLUXO, 4, { para_tipo: "fluxo" })];
    expect(
      avaliarLimites({ recentes, limites, agora, proposta: { para_tipo: "agente", para_id: AG_A, categoria: "retorno" } }),
    ).toEqual({ ok: true });
  });

  it("retornos e ações manuais não contam como transferência", () => {
    const recentes = [
      t(AG_A, 1, { categoria: "retorno" }),
      t(AG_B, 2, { categoria: "manual" }),
      t(AG_A, 3, { categoria: "retorno" }),
      t(AG_B, 4, { status: "recusada" }),
    ];
    expect(
      avaliarLimites({ recentes, limites, agora, proposta: { para_tipo: "agente", para_id: AG_A, categoria: "modelo" } }).ok,
    ).toBe(true);
  });

  it("pingue-pongue A,B,A,B → A é ciclo, mesmo com teto folgado", () => {
    const folgado = limitesSchema.parse({ transferencias_por_janela: 20 });
    const recentes = [t(AG_A, 4), t(AG_B, 3), t(AG_A, 2), t(AG_B, 1)];
    expect(
      avaliarLimites({ recentes, limites: folgado, agora, proposta: { para_tipo: "agente", para_id: AG_A, categoria: "modelo" } }),
    ).toEqual({ ok: false, motivo: "ciclo_detectado" });
  });

  it("profundidade além do teto: barra", () => {
    expect(
      avaliarLimites({
        recentes: [],
        limites,
        agora,
        profundidade: 4,
        proposta: { para_tipo: "fluxo", para_id: FLUXO, categoria: "regra" },
      }),
    ).toEqual({ ok: false, motivo: "profundidade_excedida" });
  });

  it("decisor respeita o teto de chamadas por hora", () => {
    expect(decisorPodeChamar({ chamadasNaUltimaHora: 19, limites })).toBe(true);
    expect(decisorPodeChamar({ chamadasNaUltimaHora: 20, limites })).toBe(false);
  });
});

describe("motivos", () => {
  it("todo código tem rótulo, e código desconhecido volta como está", () => {
    for (const [k, v] of Object.entries(MOTIVOS)) {
      expect(k).toMatch(/^[a-z_]+$/);
      expect(v.length).toBeGreaterThan(5);
    }
    expect(rotuloDoMotivo("pessoa_assumiu")).toBe("Uma pessoa da equipe assumiu");
    expect(rotuloDoMotivo("xyz")).toBe("xyz");
  });
});
