/**
 * OS BLOCOS DE PRÉ-TRIAGEM: menu que pergunta e numera, pergunta livre que
 * guarda o texto INTEIRO, e o nome do cliente gravado no cadastro.
 */
import { describe, expect, it } from "vitest";

import {
  listaNumerada,
  logicChoiceMenu,
  menuConfigSchema,
  respostaEhONumero,
} from "@/lib/flow-engine/nodes/gatilhos-e-menu";
import { crmUpdateContact, logicAsk, perguntarConfigSchema, RESPOSTA_SEM_TEXTO } from "@/lib/flow-engine/nodes/perguntar";
import type { DesfechoDeEnvio, FlowExecutionContext } from "@/lib/flow-engine/types";

const CONTATO = { id: "ct-1", name: "Zé", phone_number: "5511999999999", email: null, tags: [], is_blocked: false };

function ctx(p: {
  vars?: Record<string, unknown>;
  emEspera?: boolean;
  textos?: Record<string, string>;
  envio?: DesfechoDeEnvio;
  render?: (t: string) => string;
}) {
  const enviados: string[] = [];
  const nomes: string[] = [];
  const c = {
    fatos: { lead: null, contact: CONTATO, assigned_user: null },
    escopo: { event: {}, frame: { vars: p.vars ?? {} } },
    esperaEmCurso: p.emEspera ? { desde: new Date(), ate: new Date() } : null,
    render: p.render ?? ((t: string) => t),
    agora: () => new Date("2026-10-07T12:00:00Z"),
    canal: {
      enviarParaContato: async ({ texto }: { texto: string }) => {
        enviados.push(texto);
        return p.envio ?? { kind: "enviado", messageId: "m-out" };
      },
    },
    crm: {
      textoDaMensagem: async ({ messageId }: { messageId: string }) => p.textos?.[messageId] ?? null,
      atualizarNomeDoContato: async ({ nome }: { nome: string }) => {
        nomes.push(nome);
      },
    },
  } as unknown as FlowExecutionContext;
  return { c, enviados, nomes };
}

const menu = menuConfigSchema.parse({
  pergunta: "Qual sistema você usa? 💻",
  opcoes: [
    { id: "erp", label: "ERP", aceita: ["erp"] },
    { id: "pdv", label: "PDV", aceita: ["pdv"] },
  ],
  aceitar_numero: true,
  guardar_em: "sistema",
});

describe("menu que pergunta", () => {
  it("manda a pergunta com as opções numeradas, e depois espera", async () => {
    const { c, enviados } = ctx({});
    const r = await logicChoiceMenu.execute(c, menu);
    expect(enviados).toEqual(["Qual sistema você usa? 💻\n\n1️⃣ ERP\n2️⃣ PDV"]);
    expect(r.kind).toBe("await_event");
  });

  it("pergunta que não saiu segue pela saída própria, sem esperar", async () => {
    const { c } = ctx({ envio: { kind: "recusado", motivo: "sessao_caida" } });
    const r = await logicChoiceMenu.execute(c, menu);
    expect(r).toMatchObject({ kind: "advance", branch_id: "nao_saiu" });
  });

  it.each(["2", "2️⃣", " 2 ", "pdv", "PDV"])("'%s' escolhe a opção 2 e guarda com nome", async (resposta) => {
    const { c } = ctx({ emEspera: true, vars: { evento: { body_preview: resposta } } });
    const r = await logicChoiceMenu.execute(c, menu);
    expect(r).toMatchObject({ kind: "advance", branch_id: "pdv", vars: { sistema: "PDV", sistema_id: "pdv" } });
  });

  it("'10 reais' não escolhe a opção 1", () => {
    expect(respostaEhONumero("10 reais", 0)).toBe(false);
    expect(respostaEhONumero("1", 0)).toBe(true);
  });

  it("sem pergunta, o menu de antes não manda nada", async () => {
    const { c, enviados } = ctx({});
    await logicChoiceMenu.execute(c, { ...menu, pergunta: "" });
    expect(enviados).toEqual([]);
  });

  it("a saída 'não saiu' só existe com pergunta", () => {
    expect(logicChoiceMenu.branches(menu).map((b) => b.id)).toContain("nao_saiu");
    expect(logicChoiceMenu.branches({ ...menu, pergunta: "" }).map((b) => b.id)).not.toContain("nao_saiu");
  });

  it("lista numerada", () => {
    expect(listaNumerada(["A", "B"])).toBe("1️⃣ A\n2️⃣ B");
  });
});

describe("logic.ask", () => {
  const cfg = perguntarConfigSchema.parse({ pergunta: "Descreva o problema 🙏", variavel: "problema" });

  it("pergunta e espera a resposta do contato", async () => {
    const { c, enviados } = ctx({});
    const r = await logicAsk.execute(c, cfg);
    expect(enviados).toEqual(["Descreva o problema 🙏"]);
    expect(r).toMatchObject({ kind: "await_event", event_type: "message.received", match: { contact_id: "ct-1" } });
  });

  it("⭐ guarda o texto INTEIRO, não o recorte de 280 do evento", async () => {
    const longo = "x".repeat(600);
    const { c } = ctx({
      emEspera: true,
      vars: { evento: { message_id: "m-1", body_preview: longo.slice(0, 280) } },
      textos: { "m-1": longo },
    });
    const r = await logicAsk.execute(c, cfg);
    expect(r).toEqual({ kind: "advance", branch_id: "else", vars: { problema: longo } });
  });

  it("acordou pelo prazo → não respondeu", async () => {
    const { c } = ctx({ emEspera: true });
    expect(await logicAsk.execute(c, cfg)).toEqual({ kind: "advance", branch_id: "nao_respondeu" });
  });

  it("mídia sem texto vira marcador legível, nunca vazio", async () => {
    const { c } = ctx({ emEspera: true, vars: { evento: { message_id: "m-2", body_preview: "" } }, textos: { "m-2": "" } });
    expect(await logicAsk.execute(c, cfg)).toMatchObject({ vars: { problema: RESPOSTA_SEM_TEXTO } });
  });
});

describe("crm.update_contact", () => {
  it("grava o nome que o cliente disse", async () => {
    const { c, nomes } = ctx({ render: () => "  Maria   Silva " });
    const r = await crmUpdateContact.execute(c, { nome: "{{vars.nome}}" });
    expect(nomes).toEqual(["Maria Silva"]);
    expect(r).toEqual({ kind: "advance", branch_id: "else" });
  });

  it("variável que não existia não apaga o nome com lixo", async () => {
    const { c, nomes } = ctx({ render: () => "" });
    expect(await crmUpdateContact.execute(c, { nome: "{{vars.nome}}" })).toEqual({ kind: "advance", branch_id: "sem_nome" });
    expect(nomes).toEqual([]);
  });
});
