/**
 * O GATILHO DE MENSAGEM SÓ ARMA NO COMEÇO DA CONVERSA (migration 0228).
 *
 * Uma pré-triagem que arma em toda mensagem arma de novo com a própria
 * resposta do cliente ao menu. A regra pura decide; o default de cada campo
 * mantém todo fluxo já publicado igual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  decidirArmar,
  decidirAvisoDeEspera,
  lerConfigDoGatilhoDeMensagem,
  precisaOlharAConversa,
  precondicoesDaConversa,
} from "@/lib/flow-engine/gatilho-de-conversa";

describe("precondicoesDaConversa — o recorte é a CONVERSA, não o contato", () => {
  /**
   * O caso de produção (2026-10-08): o celular pessoal do dono é o MESMO
   * contato que recebe os avisos de passagem por outra conexão. O aviso de
   * 1 minuto antes estava na outra conversa; contá-lo calou a triagem.
   */
  function adminFalso() {
    const filtrosDeMensagem: Record<string, unknown> = {};
    const q = (tabela: string) => {
      const eu: Record<string, unknown> = {};
      const reg = (col: string, val: unknown) => {
        if (tabela === "messages") filtrosDeMensagem[col] = val;
        return eu;
      };
      Object.assign(eu, {
        select: () => eu,
        eq: reg,
        neq: () => eu,
        lt: () => eu,
        order: () => eu,
        limit: () => eu,
        maybeSingle: async () => {
          if (tabela === "conversations") return { data: { status: "open", assignee_kind: null }, error: null };
          // Só o recorte por CONTATO enxerga o aviso da outra conexão.
          const avisoDaOutraConversa = filtrosDeMensagem.contact_id !== undefined;
          return {
            data: avisoDaOutraConversa ? { created_at: new Date(Date.now() - 60_000).toISOString() } : null,
            error: null,
          };
        },
      });
      return eu;
    };
    return { admin: { from: q } as unknown as SupabaseClient, filtrosDeMensagem };
  }

  it("⭐ mensagem recente em OUTRA conversa do contato não cala a triagem", async () => {
    const { admin, filtrosDeMensagem } = adminFalso();
    const r = await precondicoesDaConversa(admin, {
      organizationId: "org-1",
      flowId: "flow-1",
      contactId: "ct-1",
      conversationId: "conv-suporte",
      messageId: "msg-1",
      chegouEm: new Date(),
      config: lerConfigDoGatilhoDeMensagem({ quando: "conversa_nova_ou_retorno" }),
    });
    expect(filtrosDeMensagem.conversation_id).toBe("conv-suporte");
    expect(r).toEqual({ armar: true });
  });
});

const agora = new Date("2026-10-07T12:00:00Z");
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);

describe("lerConfigDoGatilhoDeMensagem", () => {
  it("config de fluxo já publicado (só canal) continua o de sempre", () => {
    const c = lerConfigDoGatilhoDeMensagem({ canal_id: null });
    expect(c).toMatchObject({ quando: "toda_mensagem", uma_por_contato: false, silenciar_ia: false, pular_se_pessoa_atende: false });
    expect(precisaOlharAConversa(c)).toBe(false);
  });

  it("config torto não derruba o matcher — vira o de sempre", () => {
    expect(lerConfigDoGatilhoDeMensagem({ quando: "nunca" }).quando).toBe("toda_mensagem");
  });
});

describe("decidirArmar", () => {
  const triagem = lerConfigDoGatilhoDeMensagem({
    quando: "conversa_nova_ou_retorno",
    horas_de_silencio: 24,
    pular_se_pessoa_atende: true,
  });

  it("primeira mensagem do cliente → arma", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: null, agora, pessoaAtendendo: false })).toEqual({ armar: true });
  });

  it("resposta ao menu, segundos depois → não arma de novo", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: new Date(agora.getTime() - 2_000), agora, pessoaAtendendo: false })).toEqual({
      armar: false,
      motivo: "conversa_em_andamento",
    });
  });

  it("volta depois de 24h sem conversa → arma", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: horasAtras(25), agora, pessoaAtendendo: false })).toEqual({ armar: true });
  });

  it("23h depois ainda é a mesma conversa", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: horasAtras(23), agora, pessoaAtendendo: false }).armar).toBe(false);
  });

  it("pessoa da equipe com a conversa → não arma, mesmo em conversa nova", () => {
    expect(decidirArmar({ config: triagem, ultimaMensagemAntes: null, agora, pessoaAtendendo: true })).toEqual({
      armar: false,
      motivo: "pessoa_atendendo",
    });
  });

  it("toda_mensagem ignora o histórico (o de sempre)", () => {
    const sempre = lerConfigDoGatilhoDeMensagem({});
    expect(decidirArmar({ config: sempre, ultimaMensagemAntes: new Date(agora.getTime() - 1_000), agora, pessoaAtendendo: true })).toEqual({
      armar: true,
    });
  });
});

describe("decidirAvisoDeEspera — cliente passado para a equipe escreveu de novo", () => {
  const agora = new Date("2026-10-08T12:00:00Z");
  const cfg = lerConfigDoGatilhoDeMensagem({ quando: "cliente_esperando_equipe", intervalo_de_aviso_min: 30 });
  const base = { config: cfg, pessoaAtendendo: false, agora };

  it("⭐ cliente em espera escreve → avisa", () => {
    expect(decidirAvisoDeEspera({ ...base, esperaAEquipe: true, ultimoAvisoEm: null })).toEqual({ armar: true });
  });

  it("cliente atendido pela IA → não é aviso de espera", () => {
    expect(decidirAvisoDeEspera({ ...base, esperaAEquipe: false, ultimoAvisoEm: null })).toMatchObject({
      armar: false,
      motivo: "cliente_nao_espera",
    });
  });

  it("dez mensagens seguidas → um aviso só dentro do intervalo", () => {
    const ha5min = new Date(agora.getTime() - 5 * 60_000);
    expect(decidirAvisoDeEspera({ ...base, esperaAEquipe: true, ultimoAvisoEm: ha5min })).toMatchObject({
      motivo: "avisado_ha_pouco",
    });
    const ha31min = new Date(agora.getTime() - 31 * 60_000);
    expect(decidirAvisoDeEspera({ ...base, esperaAEquipe: true, ultimoAvisoEm: ha31min }).armar).toBe(true);
  });

  it("com pular_se_pessoa_atende, quem assumiu não é avisado de novo", () => {
    const c = lerConfigDoGatilhoDeMensagem({ quando: "cliente_esperando_equipe", pular_se_pessoa_atende: true });
    expect(
      decidirAvisoDeEspera({ config: c, esperaAEquipe: true, pessoaAtendendo: true, ultimoAvisoEm: null, agora }).armar,
    ).toBe(false);
  });
});
