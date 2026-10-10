import { describe, expect, it, vi } from "vitest";

import { decidir as decidirProposta } from "../decidir";
import { estadoVazio } from "../estado";
import type { DestinoEfetivo, PoliticaEfetiva } from "../politica/resolver";
import { configDaPoliticaSchema } from "../politica/schema";
import type { Decisao, PedidoDeDecisao } from "./contrato";
import { decisorPorLlm, naoDistinguiu, promptDoDecisor } from "./llm";

/**
 * O coordenador como MODELO DE DECISÃO (pedido do dono, 2026-10-10): toda
 * mensagem vai ao modelo com o contexto da conversa, e quando ele não consegue
 * distinguir, a mesma pergunta vai a um segundo ajudante.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const pedido: PedidoDeDecisao = {
  organizationId: ORG,
  conversationId: "c",
  contactId: null,
  jobId: null,
  mensagem: "sim",
  contexto: ["Atendimento: Quer que eu anote 12 rosas para sábado?"],
  atual: { chave: "faby_ai", nome: "Faby AI", quando_usar: "", exemplos: [], nao_usar: [] },
  candidatos: [
    { chave: "faby_ai", nome: "Faby AI", quando_usar: "", exemplos: [], nao_usar: [] },
    { chave: "coroa", nome: "Coroa", quando_usar: "luto", exemplos: [], nao_usar: [] },
  ],
  timeoutMs: 5000,
  confiancaMinima: 0.6,
};

/** `runModelCall` fingido: responde por ponto, e conta quem foi chamado. */
function modelo(respostas: Record<string, string | Error>) {
  const chamados: string[] = [];
  const fn = vi.fn(async (_db: unknown, _cfg: unknown, input: { purpose: string }) => {
    chamados.push(input.purpose);
    const r = respostas[input.purpose];
    if (r instanceof Error) throw r;
    return { result: { text: r ?? "" }, provider: "openrouter", model: `m-${input.purpose}`, costCents: 1 };
  });
  return { fn: fn as never, chamados };
}

function db(ajudanteEscolhido: boolean) {
  return { query: vi.fn(async () => ({ rows: [{ ok: ajudanteEscolhido }] })) } as never;
}

const decidir = (respostas: Record<string, string | Error>, ajudante: boolean) => {
  const m = modelo(respostas);
  const d = decisorPorLlm(db(ajudante), {} as never, { log, runModelCall: m.fn });
  return d.decidir(pedido).then((r) => ({ r, chamados: m.chamados }));
};

describe("naoDistinguiu", () => {
  const base: Decisao = { status: "ok", escolha: "coroa", confianca: 0.9, provedor: null, modelo: null, ms: 1, custoCents: null };
  it("dúvida, confiança baixa ou resposta inválida: não distinguiu", () => {
    expect(naoDistinguiu({ ...base, escolha: "esclarecer" }, 0.6)).toBe(true);
    expect(naoDistinguiu({ ...base, confianca: 0.4 }, 0.6)).toBe(true);
    expect(naoDistinguiu({ ...base, status: "recusou", escolha: null }, 0.6)).toBe(true);
  });
  it("decisão firme, ou falha de rede/chave/tempo: não é dúvida", () => {
    expect(naoDistinguiu(base, 0.6)).toBe(false);
    expect(naoDistinguiu({ ...base, status: "falhou", escolha: null }, 0.6)).toBe(false);
    expect(naoDistinguiu({ ...base, status: "timeout", escolha: null }, 0.6)).toBe(false);
  });
});

describe("segundo ajudante", () => {
  it("o 1º decide com firmeza: o ajudante nem é chamado", async () => {
    const { r, chamados } = await decidir(
      { coordenador_decidir: '{"escolha":"manter","confianca":0.95}' },
      true,
    );
    expect(chamados).toEqual(["coordenador_decidir"]);
    expect(r.escolha).toBe("manter");
    expect(r.ajudante).toBeUndefined();
  });

  it("o 1º fica em dúvida: a mesma pergunta vai ao ajudante, e vale a decisão dele", async () => {
    const { r, chamados } = await decidir(
      {
        coordenador_decidir: '{"escolha":"esclarecer","confianca":0.3}',
        coordenador_decidir_reserva: '{"escolha":"manter","confianca":0.9}',
      },
      true,
    );
    expect(chamados).toEqual(["coordenador_decidir", "coordenador_decidir_reserva"]);
    expect(r.escolha).toBe("manter");
    expect(r.modelo).toBe("m-coordenador_decidir_reserva");
    expect(r.ajudante).toMatchObject({ usado: true, decidiu: true, primeiro: { escolha: "esclarecer" } });
    expect(r.custoCents).toBe(2);
  });

  it("confiança abaixo da mínima também chama o ajudante", async () => {
    const { chamados } = await decidir(
      {
        coordenador_decidir: '{"escolha":"coroa","confianca":0.4}',
        coordenador_decidir_reserva: '{"escolha":"faby_ai","confianca":0.8}',
      },
      true,
    );
    expect(chamados).toHaveLength(2);
  });

  it("sem ajudante escolhido: fica a decisão do 1º, sem cair no modelo padrão da org", async () => {
    const { r, chamados } = await decidir({ coordenador_decidir: '{"escolha":"esclarecer","confianca":0.3}' }, false);
    expect(chamados).toEqual(["coordenador_decidir"]);
    expect(r.escolha).toBe("esclarecer");
  });

  it("o ajudante também não distingue: fica a do 1º, marcado", async () => {
    const { r } = await decidir(
      {
        coordenador_decidir: '{"escolha":"esclarecer","confianca":0.3}',
        coordenador_decidir_reserva: '{"escolha":"esclarecer","confianca":0.2}',
      },
      true,
    );
    expect(r.modelo).toBe("m-coordenador_decidir");
    expect(r.ajudante).toMatchObject({ usado: true, decidiu: false });
  });

  it("o 1º falhou (chave, rede): não é dúvida, o ajudante não entra", async () => {
    const { r, chamados } = await decidir({ coordenador_decidir: new Error("sem chave") }, true);
    expect(chamados).toEqual(["coordenador_decidir"]);
    expect(r.status).toBe("falhou");
  });
});

describe("o modelo recebe o contexto", () => {
  it("as falas anteriores entram no pedido", () => {
    const { user } = promptDoDecisor(pedido);
    expect(user).toContain("CONVERSA RECENTE");
    expect(user).toContain("Quer que eu anote 12 rosas para sábado?");
  });
});

describe("quando: sempre", () => {
  function destino(chave: string, agent: string): DestinoEfetivo {
    return {
      id: `d-${chave}`, chave, tipo: "agente", agent_id: agent, flow_id: null, nome: chave, quando_usar: "",
      exemplos: [], nao_usar: [], prioridade: 0, permite_conduzir: true, permite_tarefa: false, elegivel: true,
      agent_version_id: null, flow_version_id: null,
    };
  }
  const A = "00000000-0000-4000-8000-0000000000a1";
  const politica = (quando: "sempre" | "quando_regras_nao_bastam"): PoliticaEfetiva => ({
    versao_id: "v", numero: 1, modo: "active", channel_session_id: null,
    config: configDaPoliticaSchema.parse({ destino_padrao: "faby_ai", decisor: { usar_modelo: true, quando } }),
    destinos: [destino("faby_ai", A), destino("outro", "00000000-0000-4000-8000-0000000000a2")],
  });
  const estado = { ...estadoVazio(ORG, "00000000-0000-4000-8000-000000000002"), dono_tipo: "agente" as const, dono_agent_id: A, versao: 1, geracao: 1 };
  const fatos = { humanoNoComando: false, bloqueado: false, agenteFixadoLegado: null, fluxoVivoLegado: null, flowIdConduzindo: null };

  it("com agente conduzindo e mensagem curta, pergunta ao modelo", () => {
    expect(decidirProposta({ estado, politica: politica("sempre"), texto: "sim", fatos }).acao).toBe("consultar_modelo");
  });

  it("no modo de antes, mensagem curta fica com quem conduz sem perguntar", () => {
    expect(decidirProposta({ estado, politica: politica("quando_regras_nao_bastam"), texto: "sim", fatos }).acao).toBe("manter");
  });

  it("política antiga, sem o campo, continua no modo de antes", () => {
    expect(configDaPoliticaSchema.parse({ decisor: { usar_modelo: true } }).decisor.quando).toBe("quando_regras_nao_bastam");
  });
});
