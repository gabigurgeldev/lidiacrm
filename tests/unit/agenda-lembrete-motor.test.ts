/**
 * O MOTOR DO LEMBRETE (`lib/agenda/lembrete/motor.ts`), com dublês das portas.
 *
 * O que não pode quebrar calado:
 *   - lembrete em DOBRO (a reivindicação é o que impede, e ela tem de vir antes
 *     do insert na fila);
 *   - lembrete que some sem motivo escrito (os três pulos gravam o porquê);
 *   - rodada vazia auditando (`houveEfeito`).
 */
import { describe, expect, it, vi } from "vitest";

import {
  decidirLembrete,
  houveEfeito,
  rodarLembretes,
  type AgendamentoParaLembrete,
  type PortasDoLembrete,
  type ResolucaoDoCanal,
} from "@/lib/agenda/lembrete/motor";
import { MOTIVOS_DE_LEMBRETE_PULADO } from "@/lib/agenda/tipos";

const AGORA = new Date("2026-10-22T12:00:00Z");
const H = 3_600_000;

function ag(parcial: Partial<AgendamentoParaLembrete> = {}): AgendamentoParaLembrete {
  return {
    id: "ag-1",
    organization_id: "org-1",
    // Daqui a 20h, lembrete de 24h: já é hora.
    starts_at: new Date(AGORA.getTime() + 20 * H).toISOString(),
    // Marcado há 3 dias: bem antes do momento do lembrete.
    created_at: new Date(AGORA.getTime() - 72 * H).toISOString(),
    status: "confirmed",
    time_zone: "America/Sao_Paulo",
    contact_id: "contato-1",
    conversation_id: "conv-1",
    reminder_sent_at: null,
    reminder_skipped_reason: null,
    tipo: { nome: "Consulta", reminder_enabled: true, reminder_minutes_before: 1440 },
    ...parcial,
  };
}

const CANAL_OK: ResolucaoDoCanal = {
  tipo: "ok",
  canal: { conversationId: "conv-1", channelSessionId: "num-1", contactId: "contato-1", nomeDoCliente: "Maria" },
};

/** Portas em memória: a reivindicação é REAL (só a primeira chamada ganha). */
function portas(lista: AgendamentoParaLembrete[]) {
  const reivindicados = new Set<string>();
  const fila: { ag: string; texto: string }[] = [];
  const p = {
    candidatos: vi.fn<PortasDoLembrete["candidatos"]>(async () => lista),
    marcarPulado: vi.fn<PortasDoLembrete["marcarPulado"]>(async () => true),
    reivindicar: vi.fn<PortasDoLembrete["reivindicar"]>(async (a) => {
      if (reivindicados.has(a.id)) return false;
      reivindicados.add(a.id);
      return true;
    }),
    canal: vi.fn<PortasDoLembrete["canal"]>(async () => CANAL_OK),
    profissionais: vi.fn<PortasDoLembrete["profissionais"]>(async () => ["Ana"]),
    enfileirar: vi.fn<PortasDoLembrete["enfileirar"]>(async (a, _c, texto) => {
      fila.push({ ag: a.id, texto });
      return `msg-${fila.length}`;
    }),
    confirmar: vi.fn<PortasDoLembrete["confirmar"]>(async () => undefined),
    devolver: vi.fn<PortasDoLembrete["devolver"]>(async () => undefined),
    avisar: vi.fn<PortasDoLembrete["avisar"]>(async () => undefined),
  };
  return { p, fila };
}

describe("decidirLembrete — a regra pura", () => {
  it("dentro da janela do lembrete: enviar", () => {
    expect(decidirLembrete(ag(), AGORA)).toEqual({ tipo: "enviar" });
  });

  it("antes do momento do lembrete: esperar", () => {
    expect(decidirLembrete(ag({ starts_at: new Date(AGORA.getTime() + 30 * H).toISOString() }), AGORA)).toEqual({
      tipo: "esperar",
    });
  });

  it("marcado DEPOIS do momento do lembrete: pular com motivo", () => {
    const d = decidirLembrete(ag({ created_at: new Date(AGORA.getTime() - 1 * H).toISOString() }), AGORA);
    expect(d).toEqual({ tipo: "pular", motivo: "marcado_em_cima_da_hora" });
  });

  it.each([
    ["lembrete desligado no tipo", { tipo: { nome: "C", reminder_enabled: false, reminder_minutes_before: 1440 } }],
    ["sem tipo", { tipo: null }],
    ["aguardando confirmação", { status: "pending" }],
    ["cancelado", { status: "cancelled" }],
    ["sem contato", { contact_id: null }],
    ["já enfileirado", { reminder_sent_at: AGORA.toISOString() }],
    ["já pulado", { reminder_skipped_reason: "sem_conversa" }],
    ["já começou", { starts_at: new Date(AGORA.getTime() - 60_000).toISOString() }],
  ] as const)("%s: ignorar", (_nome, parcial) => {
    expect(decidirLembrete(ag(parcial as Partial<AgendamentoParaLembrete>), AGORA)).toEqual({ tipo: "ignorar" });
  });
});

describe("rodarLembretes", () => {
  it("enfileira, grava o ponteiro e conta", async () => {
    const { p, fila } = portas([ag()]);
    const r = await rodarLembretes(p, AGORA);
    expect(r).toMatchObject({ enfileirados: 1, pulados: 0, falhas: 0 });
    expect(fila).toHaveLength(1);
    expect(fila[0]!.texto).toMatch(/Olá, Maria!.*Consulta.*com Ana/);
    expect(p.confirmar).toHaveBeenCalledWith(expect.objectContaining({ id: "ag-1" }), "msg-1");
  });

  it("a reivindicação vem ANTES do insert na fila", async () => {
    const ordem: string[] = [];
    const { p } = portas([ag()]);
    p.reivindicar.mockImplementation(async () => (ordem.push("reivindicar"), true));
    p.enfileirar.mockImplementation(async () => (ordem.push("enfileirar"), "msg-1"));
    await rodarLembretes(p, AGORA);
    expect(ordem).toEqual(["reivindicar", "enfileirar"]);
  });

  it("⚠️ duas rodadas concorrentes sobre a mesma linha: UM lembrete só", async () => {
    const linha = ag();
    const { p, fila } = portas([linha]);
    const [a, b] = await Promise.all([rodarLembretes(p, AGORA), rodarLembretes(p, AGORA)]);
    expect(fila).toHaveLength(1);
    expect(a.enfileirados + b.enfileirados).toBe(1);
  });

  it("marcado em cima da hora: grava o pulo e NÃO reivindica", async () => {
    const { p } = portas([ag({ created_at: new Date(AGORA.getTime() - H).toISOString() })]);
    const r = await rodarLembretes(p, AGORA);
    expect(p.marcarPulado).toHaveBeenCalledWith(expect.anything(), "marcado_em_cima_da_hora");
    expect(p.reivindicar).not.toHaveBeenCalled();
    expect(r.por_motivo).toEqual({ marcado_em_cima_da_hora: 1 });
  });

  it("pulo que outra rodada já gravou não conta duas vezes", async () => {
    const { p } = portas([ag({ created_at: new Date(AGORA.getTime() - H).toISOString() })]);
    p.marcarPulado.mockResolvedValue(false);
    const r = await rodarLembretes(p, AGORA);
    expect(r.pulados).toBe(0);
    expect(houveEfeito(r)).toBe(false);
  });

  it.each(["sem_conversa", "contato_bloqueado"] as const)(
    "canal %s: devolve COM motivo, sem aviso na Central",
    async (motivo) => {
      const { p, fila } = portas([ag()]);
      p.canal.mockResolvedValue({ tipo: "pular", motivo });
      const r = await rodarLembretes(p, AGORA);
      expect(fila).toHaveLength(0);
      expect(p.devolver).toHaveBeenCalledWith(expect.anything(), motivo);
      expect(p.avisar).not.toHaveBeenCalled();
      expect(r.por_motivo).toEqual({ [motivo]: 1 });
    },
  );

  it("número que exige modelo: devolve com motivo E avisa na Central", async () => {
    const { p, fila } = portas([ag()]);
    p.canal.mockResolvedValue({ tipo: "pular", motivo: "canal_exige_template" });
    await rodarLembretes(p, AGORA);
    expect(fila).toHaveLength(0);
    expect(p.devolver).toHaveBeenCalledWith(expect.anything(), "canal_exige_template");
    expect(p.avisar).toHaveBeenCalledTimes(1);
    // O aviso não nomeia provedor de canal (restrição de canal do repo).
    const [, titulo, corpo] = p.avisar.mock.calls[0]! as unknown as [unknown, string, string];
    expect(`${titulo} ${corpo}`).not.toMatch(/waha|meta|zernio|stevo|cloud api/i);
  });

  it("a fila recusou: devolve SEM motivo (a próxima rodada tenta) e conta falha", async () => {
    const { p } = portas([ag()]);
    p.enfileirar.mockResolvedValue(null);
    const r = await rodarLembretes(p, AGORA);
    expect(p.devolver).toHaveBeenCalledWith(expect.anything(), null);
    expect(r).toMatchObject({ enfileirados: 0, falhas: 1 });
    expect(houveEfeito(r)).toBe(true);
  });

  it("⚠️ falha DEPOIS de enfileirar NÃO devolve — devolver seria lembrete em dobro", async () => {
    const { p } = portas([ag()]);
    p.confirmar.mockRejectedValue(new Error("caiu"));
    const r = await rodarLembretes(p, AGORA);
    expect(p.devolver).not.toHaveBeenCalled();
    expect(r.enfileirados).toBe(1);
  });

  it("exceção antes de enfileirar devolve e segue para a próxima linha", async () => {
    const { p, fila } = portas([ag({ id: "ag-1" }), ag({ id: "ag-2" })]);
    p.canal.mockRejectedValueOnce(new Error("caiu")).mockResolvedValue(CANAL_OK);
    const r = await rodarLembretes(p, AGORA);
    expect(r).toMatchObject({ enfileirados: 1, falhas: 1 });
    expect(fila.map((f) => f.ag)).toEqual(["ag-2"]);
  });

  it("rodada sem nada a fazer NÃO tem efeito (não audita)", async () => {
    const { p } = portas([ag({ starts_at: new Date(AGORA.getTime() + 48 * H).toISOString() })]);
    const r = await rodarLembretes(p, AGORA);
    expect(houveEfeito(r)).toBe(false);
  });

  it("os motivos emitidos são do vocabulário (constante, não string solta)", async () => {
    const emitidos = new Set<string>();
    for (const motivo of ["sem_conversa", "contato_bloqueado", "canal_exige_template"] as const) {
      const { p } = portas([ag()]);
      p.canal.mockResolvedValue({ tipo: "pular", motivo });
      const r = await rodarLembretes(p, AGORA);
      Object.keys(r.por_motivo).forEach((m) => emitidos.add(m));
    }
    const { p } = portas([ag({ created_at: new Date(AGORA.getTime() - H).toISOString() })]);
    Object.keys((await rodarLembretes(p, AGORA)).por_motivo).forEach((m) => emitidos.add(m));
    expect([...emitidos].sort()).toEqual([...MOTIVOS_DE_LEMBRETE_PULADO].sort());
  });
});
