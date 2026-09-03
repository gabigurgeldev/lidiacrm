/**
 * `whatsapp.notify_user` com número fixo.
 *
 * Antes disto o bloco só sabia avisar o dono do lead, lendo
 * `attendant_availability.notification_phone`. Quem monta o fluxo não tinha como
 * mandar o aviso para um número escolhido (o do gerente, o do plantão) — não
 * havia campo nenhum na tela, e a única outra variante do schema (`usuario`)
 * devolve `dead` sem enviar.
 */
import { describe, expect, it, vi } from "vitest";

import {
  notifyUserConfigSchema,
  telefoneEmE164,
  whatsappNotifyUser,
} from "@/lib/flow-engine/nodes/avisos";

type Ctx = Parameters<typeof whatsappNotifyUser.execute>[0];

function ctxFalso(opts: {
  enviarTexto: (input: { telefone: string; texto: string; interno: boolean }) => unknown;
  notificationPhone?: string | null;
  vars?: Record<string, string>;
}): Ctx {
  const vars = opts.vars ?? {};
  return {
    render: (s: string) => s.replace(/\{\{vars\.(\w+)\}\}/gu, (_m, k: string) => vars[k] ?? ""),
    agora: () => new Date("2026-09-03T18:00:00.000Z"),
    fatos: {
      lead: { id: "lead-1" },
      assigned_user:
        opts.notificationPhone === undefined
          ? null
          : { notification_phone: opts.notificationPhone },
    },
    canal: { enviarTexto: vi.fn(opts.enviarTexto) },
  } as unknown as Ctx;
}

describe("telefoneEmE164", () => {
  it("⭐ aceita o que uma pessoa digita de verdade", () => {
    expect(telefoneEmE164("+55 (11) 99999-8888")).toBe("+5511999998888");
    expect(telefoneEmE164("55 11 99999 8888")).toBe("+5511999998888");
    expect(telefoneEmE164("+5511999998888")).toBe("+5511999998888");
  });

  it("⭐ recusa fora da faixa E.164 e string sem dígito", () => {
    expect(telefoneEmE164("1234567")).toBeNull();
    expect(telefoneEmE164("1".repeat(16))).toBeNull();
    expect(telefoneEmE164("")).toBeNull();
    expect(telefoneEmE164("ligar pro gerente")).toBeNull();
  });

  it("recusa entrada absurdamente longa antes de varrer caractere a caractere", () => {
    expect(telefoneEmE164("9".repeat(200))).toBeNull();
  });
});

describe("whatsapp.notify_user — destinatário por número fixo", () => {
  it("⭐ o schema aceita a variante nova", () => {
    const r = notifyUserConfigSchema.safeParse({
      destinatario: { tipo: "telefone", telefone: "+5511999998888" },
      mensagem: "Lead novo",
    });
    expect(r.success).toBe(true);
  });

  it("⭐ envia para o número do bloco, ignorando o telefone do dono", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      notificationPhone: "+5511000000000",
    });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "telefone", telefone: "+55 (11) 99999-8888" },
      mensagem: "Lead novo",
    });

    expect(desfecho.kind).toBe("advance");
    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith({
      telefone: "+5511999998888",
      texto: "Lead novo",
      interno: true,
    });
  });

  it("⭐ resolve variável do fluxo no número (passa por ctx.render)", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      vars: { plantao: "+5521988887777" },
    });
    await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "telefone", telefone: "{{vars.plantao}}" },
      mensagem: "Lead novo",
    });

    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: "+5521988887777" }),
    );
  });

  it("⭐ número fora do formato sai pelo ramo 'sem_telefone' e NÃO envia", async () => {
    const ctx = ctxFalso({ enviarTexto: () => ({ kind: "enviado" }) });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "telefone", telefone: "{{vars.nao_existe}}" },
      mensagem: "Lead novo",
    });

    expect(desfecho).toEqual({ kind: "advance", branch_id: "sem_telefone" });
    expect(ctx.canal.enviarTexto).not.toHaveBeenCalled();
  });

  it("o caminho antigo (dono do lead) continua igual", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      notificationPhone: "+5511000000000",
    });
    await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
    });

    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: "+5511000000000" }),
    );
  });
});
