/**
 * MENSAGEM DE ANIVERSÁRIO — a regra do dia, da hora e do "uma vez só".
 *
 * O que não pode acontecer:
 *  - a pessoa receber os parabéns DUAS vezes (o cron roda de hora em hora);
 *  - receber no dia errado porque o servidor está em UTC;
 *  - quem nasceu em 29/02 só receber de quatro em quatro anos;
 *  - sair antes do horário que a empresa escolheu;
 *  - uma falha de montagem "gastar" o dia sem ninguém saber;
 *  - "Oi, {{primeiro_nome}}!" chegar literal ao cliente.
 */
import { describe, expect, it, vi } from "vitest";

import { diaLocal, mmddDoDia, proximosDias } from "@/lib/aniversario/datas";
import { rodarAniversarios, type AniversarioDeps, type OrgComAniversario } from "@/lib/aniversario/motor";
import { personalizarTexto, personalizarValores } from "@/lib/bulk-send/personalizar";
import { CONFIG_PADRAO_DE_ANIVERSARIO, salvarAniversarioSchema } from "@/lib/schemas/aniversario";

const ORG: OrgComAniversario = {
  id: "org-1",
  timezone: "America/Sao_Paulo",
  config: {
    ...CONFIG_PADRAO_DE_ANIVERSARIO,
    ativo: true,
    canal_id: "11111111-1111-4111-8111-111111111111",
    modo: "freeform",
    hora: 9,
  },
};

/** 29/09/2026 10:30 em Brasília = 13:30 UTC. */
const DEPOIS_DAS_9 = new Date("2026-09-29T13:30:00Z");

function deps(over: Partial<AniversarioDeps> = {}) {
  const reservados = new Set<string>();
  const d = {
    orgsComAniversarioLigado: vi.fn(async () => [ORG]),
    reservarDia: vi.fn(async (org: string, data: string) => {
      const k = `${org}|${data}`;
      if (reservados.has(k)) return false;
      reservados.add(k);
      return true;
    }),
    liberarDia: vi.fn(async (org: string, data: string) => {
      reservados.delete(`${org}|${data}`);
    }),
    concluirDia: vi.fn(async () => undefined),
    aniversariantes: vi.fn(async () => ["c1", "c2"]),
    criarDisparo: vi.fn(async () => ({ ok: true as const, disparoId: "bs-1", vaoReceber: 2 })),
    avisar: vi.fn(async () => undefined),
    ...over,
  };
  return d;
}

describe("calendário", () => {
  it("o dia é o da EMPRESA: 22h de Brasília ainda é hoje, mesmo já sendo amanhã em UTC", () => {
    const d = diaLocal(new Date("2026-09-30T01:00:00Z"), "America/Sao_Paulo");
    expect(d.data).toBe("2026-09-29");
    expect(d.hora).toBe(22);
  });

  it("fuso inválido cai no padrão em vez de derrubar a rodada", () => {
    expect(diaLocal(DEPOIS_DAS_9, "Lua/Base").data).toBe("2026-09-29");
  });

  it("29/02 comemora no 28/02 em ano não bissexto, e só no 29 no bissexto", () => {
    expect(mmddDoDia(2026, 2, 28)).toEqual(["02-28", "02-29"]);
    expect(mmddDoDia(2028, 2, 28)).toEqual(["02-28"]);
    expect(mmddDoDia(2028, 2, 29)).toEqual(["02-29"]);
  });

  it("próximos dias viram o mês e o ano", () => {
    const dias = proximosDias(diaLocal(new Date("2026-12-30T15:00:00Z"), "America/Sao_Paulo"), 4);
    expect(dias.map((d) => d.data)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("rodada do cron", () => {
  it("depois da hora, cria UM disparo com os aniversariantes do dia", async () => {
    const d = deps();
    const r = await rodarAniversarios(d, DEPOIS_DAS_9);
    expect(d.aniversariantes).toHaveBeenCalledWith("org-1", ["09-29"]);
    expect(d.criarDisparo).toHaveBeenCalledWith(ORG, "Aniversariantes de 29/09", ["c1", "c2"]);
    expect(d.concluirDia).toHaveBeenCalledWith("org-1", "2026-09-29", { bulkSendId: "bs-1", total: 2 });
    expect(r.disparos).toBe(1);
  });

  it("a segunda rodada do MESMO dia não cria outro disparo", async () => {
    const d = deps();
    await rodarAniversarios(d, DEPOIS_DAS_9);
    const r = await rodarAniversarios(d, new Date("2026-09-29T15:30:00Z"));
    expect(d.criarDisparo).toHaveBeenCalledTimes(1);
    expect(r.jaFeito).toBe(1);
  });

  it("antes da hora escolhida não faz nada (nem reserva o dia)", async () => {
    const d = deps();
    const r = await rodarAniversarios(d, new Date("2026-09-29T11:30:00Z")); // 08:30 BRT
    expect(d.reservarDia).not.toHaveBeenCalled();
    expect(r.antesDaHora).toBe(1);
  });

  it("chave desligada ou sem conexão não envia", async () => {
    for (const config of [
      { ...ORG.config, ativo: false },
      { ...ORG.config, canal_id: null },
    ]) {
      const d = deps({ orgsComAniversarioLigado: vi.fn(async () => [{ ...ORG, config }]) });
      await rodarAniversarios(d, DEPOIS_DAS_9);
      expect(d.criarDisparo).not.toHaveBeenCalled();
    }
  });

  it("organização bloqueada pela assinatura não envia E não gasta o dia", async () => {
    const d = deps({ podeOperar: vi.fn(async () => false) });
    const r = await rodarAniversarios(d, DEPOIS_DAS_9);
    expect(d.reservarDia).not.toHaveBeenCalled();
    expect(d.criarDisparo).not.toHaveBeenCalled();
    expect(r.bloqueadas).toBe(1);
  });

  it("sem aniversariante: registra o dia e não cria disparo", async () => {
    const d = deps({ aniversariantes: vi.fn(async () => []) });
    await rodarAniversarios(d, DEPOIS_DAS_9);
    expect(d.criarDisparo).not.toHaveBeenCalled();
    expect(d.concluirDia).toHaveBeenCalledWith("org-1", "2026-09-29", { bulkSendId: null, total: 0 });
  });

  it("falha ao montar: devolve o dia (tenta na próxima hora) e avisa a Central", async () => {
    const criar = vi.fn<AniversarioDeps["criarDisparo"]>(async () => ({ ok: false, motivo: "Conexão excluída." }));
    const d = deps({ criarDisparo: criar });
    const r = await rodarAniversarios(d, DEPOIS_DAS_9);
    expect(d.liberarDia).toHaveBeenCalledWith("org-1", "2026-09-29");
    expect(d.avisar).toHaveBeenCalledWith("org-1", "Conexão excluída.");
    expect(r.falhas).toBe(1);
    // …e a próxima hora tenta de novo.
    criar.mockResolvedValue({ ok: true, disparoId: "bs-2", vaoReceber: 2 });
    await rodarAniversarios(d, new Date("2026-09-29T14:30:00Z"));
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it("todos bloqueados/opt-out não é falha: o dia fecha sem aviso", async () => {
    const d = deps({ criarDisparo: vi.fn(async () => ({ ok: false as const, semDestinatario: true as const })) });
    await rodarAniversarios(d, DEPOIS_DAS_9);
    expect(d.avisar).not.toHaveBeenCalled();
    expect(d.liberarDia).not.toHaveBeenCalled();
  });
});

describe("personalização por destinatário", () => {
  it("troca {{primeiro_nome}} e {{nome}}", () => {
    expect(personalizarTexto("Oi, {{primeiro_nome}}! Parabéns, {{nome}}.", "Ana Souza")).toBe(
      "Oi, Ana! Parabéns, Ana Souza.",
    );
  });

  it("contato sem nome: a variável some e a pontuação órfã é arrumada — nunca o literal", () => {
    const saida = personalizarTexto("Oi, {{primeiro_nome}}! 🎉 Feliz aniversário!", null);
    expect(saida).toBe("Oi! 🎉 Feliz aniversário!");
    expect(saida).not.toContain("{{");
  });

  it("variável desconhecida continua literal (não é desta regra)", () => {
    expect(personalizarTexto("Cupom {{cupom}}", "Ana")).toBe("Cupom {{cupom}}");
  });

  it("valor de modelo oficial sem nome vira 'cliente' — a Meta recusa parâmetro vazio", () => {
    expect(personalizarValores({ "1": "{{primeiro_nome}}" }, "")).toEqual({ "1": "cliente" });
    expect(personalizarValores({ "1": "{{primeiro_nome}}", "2": "fixo" }, "Bia Lima")).toEqual({
      "1": "Bia",
      "2": "fixo",
    });
  });
});

describe("configuração", () => {
  it("ligar exige conexão, e a API oficial exige modelo", () => {
    expect(salvarAniversarioSchema.safeParse({ ativo: true }).success).toBe(false);
    const oficialSemModelo = salvarAniversarioSchema.safeParse({
      ativo: true,
      canal_id: ORG.config.canal_id,
      modo: "template",
    });
    expect(oficialSemModelo.success).toBe(false);
  });

  it("desligar sempre pode, mesmo sem conexão", () => {
    expect(salvarAniversarioSchema.safeParse({ ativo: false }).success).toBe(true);
  });
});
