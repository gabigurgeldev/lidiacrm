/**
 * O TEXTO DA MENSAGEM CHEGA AOS DOIS BLOCOS QUE DEPENDEM DELE?
 *
 * ## O defeito que este arquivo existe para impedir
 *
 * `textoDoEvento` procurava o texto em `body | text | message | conteudo`. O
 * evento `message.received` nasce do gatilho `trg_messages_emit_event` no
 * banco, e `fn_emit_message_event` grava a chave **`body_preview`** — nenhuma
 * das quatro. A função devolvia `""` para toda mensagem real, `mensagemCasa("")`
 * saía `false` na primeira linha, e os dois blocos que dependem do que o
 * cliente ESCREVEU estavam mortos: o gatilho por palavra nunca disparava, e o
 * menu nunca reconhecia a resposta.
 *
 * Não era intermitente — era 100%. Medido em produção: quatro execuções, todas
 * `dead` com `mensagem_sem_a_palavra` e `steps_taken=0`, sendo a última nascida
 * de uma mensagem cujo texto era EXATAMENTE a palavra configurada.
 *
 * ## Por que o payload aqui é copiado literal
 *
 * O caso que faltava não era "uma mensagem qualquer": era o payload REAL, com
 * as chaves que o emissor de verdade escreve. Um teste com `{ body: "oi" }`
 * passava verde o tempo todo enquanto a produção estava 100% quebrada — foi
 * exatamente essa a lacuna. Este objeto veio de
 * `select payload from event_log where event_type='message.received'`.
 */
import { describe, expect, it } from "vitest";

import {
  logicChoiceMenu,
  mensagemCasa,
  RAMO_NAO_ENTENDI,
  triggerKeyword,
} from "./gatilhos-e-menu";
import type { FlowExecutionContext } from "../types";

/** Copiado de `event_log` em produção, sem editar nada além de encurtar ids. */
const PAYLOAD_REAL = {
  type: "text",
  status: "delivered",
  direction: "inbound",
  contact_id: "039510c1-7ee5-4b9d-b46d-392eee30ed37",
  message_id: "6bd8e385-dfe2-4d9d-9ddb-240bf7eb3b8f",
  external_id: "wamid.HBgMNTU5NDgxMDA0OTAwFQIAEhgg",
  body_preview: "testedefluxopatrão",
  conversation_id: "20bd6d58-995d-475a-9eaa-0ed277f43d0e",
  channel_session_id: "c5dfb271-f922-4607-8bed-c1a7188d9484",
};

function ctx(event: Record<string, unknown>, varsDaFrente: Record<string, unknown> = {}) {
  return {
    escopo: { event, frame: { vars: varsDaFrente } },
    render: (t: string) => t,
    agora: () => new Date("2026-09-04T13:31:15.000Z"),
  } as unknown as FlowExecutionContext;
}

describe("trigger.keyword com o payload REAL do evento", () => {
  it("⭐ dispara quando a palavra está em `body_preview`", async () => {
    const r = await triggerKeyword.execute(ctx(PAYLOAD_REAL), {
      palavras: ["testedefluxopatrão"],
      modo: "contem",
    });
    expect(r).toEqual({ kind: "advance", branch_id: "else" });
  });

  it("⭐ o caso EXATO que morreu em produção: acento e caixa não atrapalham", async () => {
    const r = await triggerKeyword.execute(
      ctx({ ...PAYLOAD_REAL, body_preview: "Quero TESTEDEFLUXOPATRAO agora" }),
      { palavras: ["testedefluxopatrão"], modo: "contem" },
    );
    expect(r).toEqual({ kind: "advance", branch_id: "else" });
  });

  it("mensagem sem a palavra continua morrendo — o conserto não vira 'aceita tudo'", async () => {
    const r = await triggerKeyword.execute(ctx({ ...PAYLOAD_REAL, body_preview: "bom dia" }), {
      palavras: ["orçamento"],
      modo: "contem",
    });
    expect(r).toEqual({ kind: "dead", reason: "mensagem_sem_a_palavra" });
  });

  it("evento sem texto nenhum continua morrendo", async () => {
    const r = await triggerKeyword.execute(ctx({ type: "image", direction: "inbound" }), {
      palavras: ["oi"],
      modo: "contem",
    });
    expect(r).toEqual({ kind: "dead", reason: "mensagem_sem_a_palavra" });
  });

  it("as chaves antigas seguem valendo — outro emissor pode usá-las", async () => {
    for (const chave of ["body", "text", "message", "conteudo"]) {
      const r = await triggerKeyword.execute(ctx({ [chave]: "quero orçamento" }), {
        palavras: ["orçamento"],
        modo: "contem",
      });
      expect(r, `chave ${chave}`).toEqual({ kind: "advance", branch_id: "else" });
    }
  });
});

describe("logic.choice_menu com o payload REAL", () => {
  const CONFIG = {
    pergunta: "Escolha:",
    opcoes: [
      { id: "op1", label: "Falar com vendas", aceita: ["1"] },
      { id: "op2", label: "Suporte", aceita: ["2"] },
    ],
    modo: "exata" as const,
    prazo_ms: 10 * 60_000,
  };

  it("⭐ reconhece a opção que veio em `body_preview`", async () => {
    // A mesma cegueira do gatilho: o menu lia pelo mesmo caminho, então nunca
    // reconhecia resposta nenhuma e caía sempre em "Não entendi".
    const r = await logicChoiceMenu.execute(
      ctx(PAYLOAD_REAL, { evento: { ...PAYLOAD_REAL, body_preview: "2" } }),
      CONFIG,
    );
    expect(r.kind).toBe("advance");
    if (r.kind === "advance") expect(r.branch_id).toBe("op2");
  });

  it("resposta fora das opções segue caindo em 'não entendi'", async () => {
    // `RAMO_NAO_ENTENDI` é o pega-tudo (`else`) do bloco, e não um id próprio:
    // "não entendi" É o senão do menu.
    const r = await logicChoiceMenu.execute(
      ctx(PAYLOAD_REAL, { evento: { ...PAYLOAD_REAL, body_preview: "quero outra coisa" } }),
      CONFIG,
    );
    expect(r.kind).toBe("advance");
    if (r.kind === "advance") {
      expect(r.branch_id).toBe(RAMO_NAO_ENTENDI);
      // E o que a pessoa escreveu fica guardado — é o que permite descobrir
      // depois quais respostas o menu não previu.
      expect(r.vars?.menu_resposta).toBe("quero outra coisa");
    }
  });
});

describe("mensagemCasa — a régua de comparação", () => {
  it("⭐ texto vazio nunca casa: é o que transformava o defeito em 100%", () => {
    expect(mensagemCasa("", ["oi"], "contem")).toBe(false);
  });

  it("`exata` não deixa '10 reais' disparar a opção '1'", () => {
    expect(mensagemCasa("10 reais", ["1"], "exata")).toBe(false);
    expect(mensagemCasa("1", ["1"], "exata")).toBe(true);
  });
});
