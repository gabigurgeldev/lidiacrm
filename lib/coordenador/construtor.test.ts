import { describe, expect, it } from "vitest";

import { politicaComAgente } from "./construtor";
import { politicaSchema } from "./politica/schema";

/**
 * O construtor de agente prepara o coordenador — sem nunca ligá-lo por conta
 * própria. Regra pura; a publicação é a mesma RPC provada nos invariantes.
 */

const AGENTE = { id: "11111111-1111-4111-8111-111111111111", nome: "Bia, da Clínica Sorriso" };
const OUTRO = "22222222-2222-4222-8222-222222222222";
const FLUXO = { id: "33333333-3333-4333-8333-333333333333", nome: "Cadastro de paciente" };

const coordenacao = {
  quando_usar: "Agendamento de consultas.",
  exemplos: ["quero marcar"],
  nao_usar: ["boleto"],
  fluxos_chamaveis: [] as string[],
};

describe("politicaComAgente", () => {
  it("sem coordenador ainda: nasce em OBSERVAR, com o agente como destino e padrão", () => {
    const r = politicaComAgente(null, AGENTE, coordenacao, []);
    expect(r.criada).toBe(true);
    expect(r.politica.modo).toBe("shadow");
    expect(r.politica.destinos).toHaveLength(1);
    expect(r.politica.destinos[0]).toMatchObject({
      tipo: "agente",
      agent_id: AGENTE.id,
      quando_usar: "Agendamento de consultas.",
      exemplos: ["quero marcar"],
      nao_usar: ["boleto"],
    });
    expect(r.politica.config.destino_padrao).toBe(r.chave);
  });

  it("com coordenador ATIVO: o modo NÃO muda — ligar é decisão de quem administra", () => {
    const atual = politicaSchema.parse({
      modo: "active",
      config: { destino_padrao: "comercial" },
      destinos: [{ chave: "comercial", tipo: "agente", agent_id: OUTRO }],
    });
    const r = politicaComAgente(atual, AGENTE, coordenacao, []);
    expect(r.criada).toBe(false);
    expect(r.politica.modo).toBe("active");
    expect(r.politica.destinos.map((d) => d.agent_id)).toEqual([OUTRO, AGENTE.id]);
    expect(r.politica.config.destino_padrao).toBe("comercial");
  });

  it("agente que já é destino: atualiza a descrição, não duplica", () => {
    const atual = politicaSchema.parse({
      modo: "shadow",
      destinos: [{ chave: "bia", tipo: "agente", agent_id: AGENTE.id, quando_usar: "velho" }],
    });
    const r = politicaComAgente(atual, AGENTE, coordenacao, []);
    expect(r.chave).toBe("bia");
    expect(r.politica.destinos).toHaveLength(1);
    expect(r.politica.destinos[0]?.quando_usar).toBe("Agendamento de consultas.");
  });

  it("fluxo chamável entra como destino e o agente ganha permissão de chamá-lo e voltar", () => {
    const r = politicaComAgente(null, AGENTE, { ...coordenacao, fluxos_chamaveis: [FLUXO.id] }, [FLUXO]);
    const fluxo = r.politica.destinos.find((d) => d.tipo === "fluxo");
    expect(fluxo).toMatchObject({ flow_id: FLUXO.id });
    expect(r.politica.config.permissoes[r.chave]?.pode_chamar).toEqual([fluxo!.chave]);
  });

  it("fluxo que não está na lista de fluxos ativos é ignorado — não vira destino fantasma", () => {
    const r = politicaComAgente(null, AGENTE, { ...coordenacao, fluxos_chamaveis: [FLUXO.id] }, []);
    expect(r.politica.destinos.some((d) => d.tipo === "fluxo")).toBe(false);
    expect(r.politica.config.permissoes[r.chave]).toBeUndefined();
  });

  it("a política resultante passa no MESMO schema que a rota de publicação usa", () => {
    const r = politicaComAgente(null, AGENTE, { ...coordenacao, fluxos_chamaveis: [FLUXO.id] }, [FLUXO]);
    expect(politicaSchema.safeParse(r.politica).success).toBe(true);
  });
});
