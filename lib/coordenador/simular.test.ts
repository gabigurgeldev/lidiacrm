import { describe, expect, it } from "vitest";

import type { Decisor } from "./decisor/contrato";
import type { DestinoEfetivo, PoliticaEfetiva } from "./politica/resolver";
import { configDaPoliticaSchema } from "./politica/schema";
import { simular } from "./simular";

/**
 * O simulador não pode chamar de falha o que não aconteceu. Com "Consultar o
 * modelo de verdade" desligado, ele dizia "O modelo de decisão falhou" — e quem
 * testava (produção, 2026-10-10) concluiu que o coordenador estava quebrado por
 * um motivo que não era o real.
 */

const ORG = "00000000-0000-4000-8000-000000000001";

function destino(chave: string, tipo: "agente" | "fluxo"): DestinoEfetivo {
  return {
    id: `d-${chave}`,
    chave,
    tipo,
    agent_id: tipo === "agente" ? "00000000-0000-4000-8000-0000000000a1" : null,
    flow_id: tipo === "fluxo" ? "00000000-0000-4000-8000-0000000000f1" : null,
    nome: chave,
    quando_usar: "",
    exemplos: [],
    nao_usar: [],
    prioridade: 0,
    permite_conduzir: true,
    permite_tarefa: false,
    elegivel: true,
    agent_version_id: null,
    flow_version_id: tipo === "fluxo" ? "v1" : null,
  };
}

const politica: PoliticaEfetiva = {
  versao_id: "pv1",
  numero: 1,
  modo: "active",
  channel_session_id: null,
  config: configDaPoliticaSchema.parse({ destino_padrao: "faby_ai" }),
  destinos: [destino("faby_ai", "agente"), destino("coroa", "fluxo")],
};

const cenario = { texto: "oi", dono: { tipo: null as never, chave: null }, humanoNoComando: false };

describe("simular", () => {
  it("sem o modelo ligado: diz que não consultou, e não que falhou", async () => {
    const r = await simular({ politica, cenario, decisor: null, organizationId: ORG });
    expect(r.precisou_do_modelo).toBe(true);
    expect(r.usou_modelo).toBe(false);
    expect(r.motivo).toBe("modelo_nao_consultado");
    expect(r.motivo_legivel).not.toMatch(/falhou/i);
    expect(r.destino?.chave).toBe("faby_ai");
  });

  it("modelo consultado e falhou de verdade: aí sim é falha", async () => {
    const decisor: Decisor = {
      decidir: async () => ({
        status: "falhou",
        escolha: null,
        confianca: null,
        provedor: null,
        modelo: null,
        ms: 5,
        custoCents: null,
        erro: "org sem credencial LLM utilizável",
      }),
    };
    const r = await simular({ politica, cenario, decisor, organizationId: ORG });
    expect(r.motivo).toBe("decisor_falhou");
    expect(r.usou_modelo).toBe(true);
  });
});
