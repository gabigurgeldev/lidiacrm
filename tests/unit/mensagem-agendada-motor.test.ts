/**
 * O MOTOR DA MENSAGEM AGENDADA — Lembrar → "Agendar mensagem…".
 *
 * Dublês nas portas: o que se mede aqui é a DECISÃO (janela, contato,
 * desfecho, aviso), não o banco. O banco é da migration 0220 e dos invariantes.
 */
import { describe, expect, it, vi } from "vitest";

import {
  houveEfeito,
  rodarAgendamentos,
  type Agendamento,
  type Conclusao,
  type DesfechoDoEnvio,
  type PortasDoMotor,
} from "@/lib/mensagem-agendada/motor";

const AGORA = new Date("2026-10-01T12:00:00Z");

function agendamento(extra: Partial<Agendamento> = {}): Agendamento {
  return {
    id: "a1",
    organization_id: "org-1",
    conversation_id: "conv-1",
    contact_id: "ct-1",
    channel_session_id: "s-1",
    body: "Oi! Lembrando da consulta amanhã.",
    scheduled_for: AGORA.toISOString(),
    notify_phone: null,
    notify_body: null,
    created_by_user_id: "u-1",
    ...extra,
  };
}

function portas(over: Partial<PortasDoMotor> & { vencidas?: Agendamento[] } = {}) {
  const concluidas: Array<[string, Conclusao]> = [];
  const avisos: Array<[string, string]> = [];
  const remarcadas: Array<[string, string]> = [];
  const p: PortasDoMotor = {
    resgatarPresas: async () => [],
    reivindicarVencidas: async () => over.vencidas ?? [agendamento()],
    podeOperar: async () => true,
    janelaAbreEm: async () => null,
    contato: async () => ({ id: "ct-1", phone_number: "+5511999990000", is_blocked: false }),
    enviarAoCliente: vi.fn(async (): Promise<DesfechoDoEnvio> => ({
      kind: "enviado",
      messageId: "m-1",
    })),
    enviarAviso: vi.fn(async (): Promise<DesfechoDoEnvio> => ({
      kind: "enviado",
      messageId: "m-2",
    })),
    remarcar: async (a, iso) => {
      remarcadas.push([a.id, iso]);
    },
    concluir: async (a, c) => {
      concluidas.push([a.id, c]);
    },
    abrirAviso: async (_a, titulo, corpo) => {
      avisos.push([titulo, corpo]);
    },
    ...over,
  };
  return { p, concluidas, avisos, remarcadas };
}

describe("envio no horário", () => {
  it("envia ao cliente e grava `sent` com o id da mensagem", async () => {
    const { p, concluidas, avisos } = portas();
    const r = await rodarAgendamentos(p, AGORA);
    expect(r.enviados).toBe(1);
    expect(concluidas[0]?.[1]).toMatchObject({ status: "sent", message_id: "m-1" });
    expect(avisos).toHaveLength(0);
  });

  it("mensagem na fila do canal vira `queued`, não `sent`", async () => {
    const { p, concluidas } = portas({
      enviarAoCliente: async () => ({
        kind: "na_fila",
        messageId: "m-1",
        motivo: "sessao_subindo",
      }),
    });
    const r = await rodarAgendamentos(p, AGORA);
    expect(r.na_fila).toBe(1);
    expect(concluidas[0]?.[1].status).toBe("queued");
  });

  it("falha no envio vira `failed` e abre Aviso na Central", async () => {
    const { p, concluidas, avisos } = portas({
      enviarAoCliente: async () => ({
        kind: "recusado",
        messageId: "m-1",
        motivo: "número desconectado",
      }),
    });
    const r = await rodarAgendamentos(p, AGORA);
    expect(r.falhos).toBe(1);
    expect(concluidas[0]?.[1]).toMatchObject({
      status: "failed",
      failure_reason: "número desconectado",
    });
    expect(avisos[0]?.[0]).toBe("Mensagem agendada não saiu");
  });
});

describe("janela do número", () => {
  it("fora da janela, remarca para a abertura e NÃO envia", async () => {
    const enviar = vi.fn();
    const { p, remarcadas, concluidas } = portas({
      janelaAbreEm: async () => "2026-10-02T10:00:00.000Z",
      enviarAoCliente: enviar,
    });
    const r = await rodarAgendamentos(p, AGORA);
    expect(r.remarcados).toBe(1);
    expect(remarcadas).toEqual([["a1", "2026-10-02T10:00:00.000Z"]]);
    expect(enviar).not.toHaveBeenCalled();
    expect(concluidas).toHaveLength(0);
  });
});

describe("contato", () => {
  it.each([
    [{ is_blocked: true }, "o cliente bloqueou o atendimento"],
    [{ is_anonymized: true }, "anonimizado"],
    [{ phone_number: null }, "não tem telefone"],
  ])("contato %j não recebe, e o Aviso diz por quê", async (extra, frase) => {
    const enviar = vi.fn();
    const { p, concluidas, avisos } = portas({
      contato: async () => ({
        id: "ct-1",
        phone_number: "+5511999990000",
        is_blocked: false,
        ...extra,
      }),
      enviarAoCliente: enviar,
    });
    await rodarAgendamentos(p, AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(concluidas[0]?.[1].status).toBe("failed");
    expect(avisos[0]?.[1]).toContain(frase);
  });

  it("consentimento de marketing recusado NÃO barra — é conversa 1:1 do atendente", async () => {
    const { p, concluidas } = portas({
      contato: async () => ({
        id: "ct-1",
        phone_number: "+5511999990000",
        consent: { marketing: { declined_at: "2026-01-01T00:00:00Z" } },
      }),
    });
    await rodarAgendamentos(p, AGORA);
    expect(concluidas[0]?.[1].status).toBe("sent");
  });
});

describe("aviso ao atendente", () => {
  const comAviso = agendamento({ notify_phone: "+5511988887777", notify_body: "Ligar para a Ana" });

  it("sai junto e grava o id da mensagem do aviso", async () => {
    const { p, concluidas } = portas({ vencidas: [comAviso] });
    await rodarAgendamentos(p, AGORA);
    expect(p.enviarAviso).toHaveBeenCalledTimes(1);
    expect(concluidas[0]?.[1].notify_message_id).toBe("m-2");
  });

  it("sem telefone de aviso, não tenta avisar", async () => {
    const { p } = portas();
    await rodarAgendamentos(p, AGORA);
    expect(p.enviarAviso).not.toHaveBeenCalled();
  });

  it("aviso que falha não desfaz o envio ao cliente, e vira Aviso na Central", async () => {
    const { p, concluidas, avisos } = portas({
      vencidas: [comAviso],
      enviarAviso: async () => ({ kind: "recusado", motivo: "número inválido" }),
    });
    await rodarAgendamentos(p, AGORA);
    expect(concluidas[0]?.[1].status).toBe("sent");
    expect(avisos.map((a) => a[0])).toContain("Aviso da mensagem agendada não saiu");
  });

  it("sai mesmo quando o envio ao cliente falhou — o atendente pediu para ser lembrado", async () => {
    const { p } = portas({
      vencidas: [comAviso],
      enviarAoCliente: async () => ({ kind: "recusado", motivo: "x" }),
    });
    await rodarAgendamentos(p, AGORA);
    expect(p.enviarAviso).toHaveBeenCalledTimes(1);
  });
});

describe("sem envio em dobro", () => {
  it("`sending` preso vira `failed` com Aviso e nunca é reenviado", async () => {
    const enviar = vi.fn();
    const { p, concluidas, avisos } = portas({
      resgatarPresas: async () => [agendamento({ id: "presa" })],
      vencidas: [],
      enviarAoCliente: enviar,
    });
    const r = await rodarAgendamentos(p, AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(concluidas[0]).toEqual([
      "presa",
      expect.objectContaining({ status: "failed", failure_reason: "envio_interrompido" }),
    ]);
    expect(avisos[0]?.[0]).toBe("Mensagem agendada pode não ter saído");
    expect(r.falhos).toBe(1);
  });
});

describe("assinatura", () => {
  it("org sem acesso não envia, e o Aviso diz por quê", async () => {
    const enviar = vi.fn();
    const { p, concluidas } = portas({ podeOperar: async () => false, enviarAoCliente: enviar });
    await rodarAgendamentos(p, AGORA);
    expect(enviar).not.toHaveBeenCalled();
    expect(concluidas[0]?.[1].failure_reason).toBe("assinatura_inativa");
  });
});

describe("houveEfeito — a rodada vazia não audita", () => {
  it("nada vencido → sem efeito", async () => {
    const { p } = portas({ vencidas: [] });
    expect(houveEfeito(await rodarAgendamentos(p, AGORA))).toBe(false);
  });

  it("um envio → com efeito", async () => {
    const { p } = portas();
    expect(houveEfeito(await rodarAgendamentos(p, AGORA))).toBe(true);
  });
});
