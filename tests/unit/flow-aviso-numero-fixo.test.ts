/**
 * `whatsapp.notify_user` — para quem, por qual número, e o que acontece quando
 * o aviso NÃO sai.
 *
 * Este arquivo nasceu do destinatário por número fixo: antes dele o bloco só
 * sabia avisar o dono do lead, lendo `attendant_availability.notification_phone`,
 * e quem montava o fluxo não tinha como mandar para o gerente ou o plantão.
 *
 * Depois recebeu os três defeitos que o bloco ainda tinha, todos MUDOS:
 *
 *   1. **Destinatário por pessoa matava a execução.** A variante `usuario` do
 *      schema devolvia `{ kind: "dead" }` — sem mensagem, sem registro, sem
 *      nada na tela.
 *   2. **Não dava para escolher a conexão.** O aviso saía sempre pela primeira
 *      conexão da organização por `created_at` — e, quando nenhuma estava
 *      `WORKING`, por QUALQUER uma, inclusive desconectada. Quem tinha mais de
 *      um número não tinha onde dizer qual queria.
 *   3. **Falha não deixava rastro.** As duas saídas de exceção do bloco podem
 *      ficar soltas (a publicação não as cobra, de propósito), e aí o caminho
 *      terminava ali sem uma linha em lugar nenhum: o vendedor não era avisado
 *      e o fluxo terminava dizendo que deu certo.
 */
import { describe, expect, it, vi } from "vitest";

import {
  notifyUserConfigSchema,
  telefoneEmE164,
  whatsappNotifyUser,
} from "@/lib/flow-engine/nodes/avisos";

type Ctx = Parameters<typeof whatsappNotifyUser.execute>[0];

const CANAL = "3f2b9f7e-0000-4000-8000-aaaaaaaaaaaa";

function ctxFalso(opts: {
  enviarTexto: (input: {
    telefone: string;
    texto: string;
    interno: boolean;
    channelSessionId?: string | null;
  }) => unknown;
  notificationPhone?: string | null;
  vars?: Record<string, string>;
  /** Telefone de aviso por pessoa, para o destinatário `usuario`. */
  equipe?: Record<string, string | null>;
}): Ctx {
  const vars = opts.vars ?? {};
  const equipe = opts.equipe ?? {};
  return {
    nodeId: "avisa",
    executionId: "exec-1",
    render: (s: string) => s.replace(/\{\{vars\.(\w+)\}\}/gu, (_m, k: string) => vars[k] ?? ""),
    agora: () => new Date("2026-09-03T18:00:00.000Z"),
    fatos: {
      lead: { id: "lead-1", title: "Loja do Gabriel" },
      assigned_user:
        opts.notificationPhone === undefined
          ? null
          : { notification_phone: opts.notificationPhone },
    },
    crm: { telefoneDoUsuario: vi.fn(async ({ userId }) => equipe[userId] ?? null) },
    canal: { enviarTexto: vi.fn(opts.enviarTexto) },
    avisos: { abrir: vi.fn(async () => {}) },
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
      canal_id: null,
    });

    expect(desfecho.kind).toBe("advance");
    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith({
      telefone: "+5511999998888",
      texto: "Lead novo",
      interno: true,
      channelSessionId: null,
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
      canal_id: null,
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
      canal_id: null,
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
      canal_id: null,
    });

    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: "+5511000000000" }),
    );
  });
});

describe("whatsapp.notify_user — por qual conexão o aviso sai", () => {
  it("⭐ manda pela conexão ESCOLHIDA no bloco", async () => {
    // O defeito que este caso barra: o `canal_id` existir na tela e não chegar
    // ao envio. O aviso sairia pelo número mais antigo da organização, e a
    // escolha da pessoa seria enfeite — sem erro nenhum para investigar.
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      notificationPhone: "+5511000000000",
    });
    await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: CANAL,
    });

    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith(
      expect.objectContaining({ channelSessionId: CANAL }),
    );
  });

  it("o schema aceita config ANTIGA, sem o campo — fluxo publicado não pode parar", () => {
    // `strictObject` recusaria chave a mais, mas o campo é novo: quem já usa o
    // bloco tem grafo sem ele. Faltar precisa virar `null`, não erro de parse —
    // senão a atualização derruba fluxo que estava rodando.
    const r = notifyUserConfigSchema.safeParse({
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.canal_id).toBeNull();
  });

  it("o schema recusa canal que não é um identificador", () => {
    const r = notifyUserConfigSchema.safeParse({
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: "o numero da loja",
    });
    expect(r.success).toBe(false);
  });
});

describe("whatsapp.notify_user — destinatário por PESSOA da equipe", () => {
  it("⭐ resolve o telefone pela porta e envia — antes isto matava a execução", async () => {
    // O defeito: `{ kind: "dead", reason: "destinatario_fixo_ainda_nao_suportado" }`.
    // A execução morria sem mensagem, sem aviso e sem nada na tela.
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      equipe: { "user-7": "+5562988887777" },
    });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "usuario", user_id: "user-7" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(desfecho.kind).toBe("advance");
    expect(ctx.crm.telefoneDoUsuario).toHaveBeenCalledWith({ userId: "user-7" });
    expect(ctx.canal.enviarTexto).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: "+5562988887777" }),
    );
  });

  it("⭐ pessoa SEM telefone de aviso sai pelo ramo próprio, e não mata a execução", async () => {
    const ctx = ctxFalso({ enviarTexto: () => ({ kind: "enviado" }), equipe: {} });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "usuario", user_id: "user-sem-telefone" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(desfecho).toEqual({ kind: "advance", branch_id: "sem_telefone" });
    expect(ctx.canal.enviarTexto).not.toHaveBeenCalled();
  });
});

describe("whatsapp.notify_user — quando o aviso não sai, alguém fica sabendo", () => {
  it("⭐ sem telefone: abre aviso na Central", async () => {
    // As saídas de exceção podem ficar SOLTAS — a publicação não as cobra. Sem
    // este registro, o caminho termina ali e o vendedor não avisado some.
    const ctx = ctxFalso({ enviarTexto: () => ({ kind: "enviado" }) });
    await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(ctx.avisos.abrir).toHaveBeenCalledTimes(1);
    expect(ctx.avisos.abrir).toHaveBeenCalledWith(
      expect.objectContaining({ severidade: "warn", refId: "exec-1" }),
    );
  });

  it("⭐ envio recusado: abre aviso na Central e sai por 'nao_saiu'", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "recusado", motivo: "sem_conexao_de_whatsapp" }),
      notificationPhone: "+5511000000000",
    });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(desfecho).toMatchObject({ kind: "advance", branch_id: "nao_saiu" });
    expect(ctx.avisos.abrir).toHaveBeenCalledTimes(1);
    const corpo = String(vi.mocked(ctx.avisos.abrir).mock.calls[0]?.[0]?.corpo ?? "");
    expect(corpo, "o motivo precisa chegar a quem lê o aviso").toContain(
      "sem_conexao_de_whatsapp",
    );
  });

  it("⭐ ficou na fila: também registra — 'na fila' não é 'avisado'", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "na_fila", motivo: "fora_de_janela" }),
      notificationPhone: "+5511000000000",
    });
    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(desfecho).toMatchObject({ branch_id: "nao_saiu" });
    expect(ctx.avisos.abrir).toHaveBeenCalledTimes(1);
  });

  it("envio que DEU CERTO não abre aviso nenhum (contra-prova)", async () => {
    // Sem esta contra-prova, um bloco que avisasse sempre passaria nos casos
    // acima e encheria a Central de ruído — o jeito mais rápido de a Central
    // deixar de ser lida.
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "enviado" }),
      notificationPhone: "+5511000000000",
    });
    await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(ctx.avisos.abrir).not.toHaveBeenCalled();
  });

  it("aviso que falha ao ser aberto NÃO derruba o fluxo", async () => {
    const ctx = ctxFalso({
      enviarTexto: () => ({ kind: "recusado", motivo: "sem_conexao_de_whatsapp" }),
      notificationPhone: "+5511000000000",
    });
    vi.mocked(ctx.avisos.abrir).mockRejectedValueOnce(new Error("central fora do ar"));

    const desfecho = await whatsappNotifyUser.execute(ctx, {
      destinatario: { tipo: "dono_do_lead" },
      mensagem: "Lead novo",
      canal_id: null,
    });

    expect(desfecho).toMatchObject({ kind: "advance", branch_id: "nao_saiu" });
  });
});
