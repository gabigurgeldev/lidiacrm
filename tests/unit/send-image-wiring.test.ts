import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_DEFS,
  DEFAULT_MAX_IMAGES_PER_TURN,
  DEFAULT_MAX_SENDS_PER_TURN,
} from "@/lib/agent-engine/agent/inbound-turn";
import { READ_ONLY_TOOLS } from "@/lib/agent-engine/agent/tool-breaker";

/**
 * A LIGAÇÃO do `send_image` no turno do agente — mesmo tipo de guarda de
 * `send-options-wiring.test.ts`, e pela mesma razão: as peças (resolver a foto,
 * o sink com a opção interna, o handler conferindo a pasta) têm testes
 * próprios; o que nenhum deles toca é o que o `execute` passa à cadeia de
 * guardrails e ao canal.
 *
 * Prova que as decisões abaixo estão escritas no código que roda e que
 * removê-las produz vermelho. NÃO prova o turno inteiro com um modelo
 * escolhendo a tool — isso é do harness de `tests/invariants/`.
 */

const FONTE = fs
  .readFileSync(path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8")
  // O worktree Windows faz checkout em CRLF; as âncoras abaixo são de uma linha.
  .replace(/\r\n/g, "\n");

function trecho(inicio: string, fim: string): string {
  const i = FONTE.indexOf(inicio);
  expect(i, `âncora \`${inicio}\` sumiu do turno`).toBeGreaterThan(-1);
  const j = FONTE.indexOf(fim, i);
  expect(j, `âncora de fim \`${fim}\` sumiu`).toBeGreaterThan(i);
  return FONTE.slice(i, j);
}

const corpoDoExecute = () => trecho("    send_image: tool({", "    send_options: tool({");

/** O `runBeforeSend({...})` do send_image, até o fechamento da chamada. */
function argsDaCadeia(): string {
  const corpo = corpoDoExecute();
  const i = corpo.indexOf("runBeforeSend({");
  expect(i, "send_image não chama runBeforeSend").toBeGreaterThan(-1);
  return corpo.slice(i, corpo.indexOf("\n          });", i));
}

/**
 * As chaves que o send_message passa à cadeia (`beforeSendArgs`). Derivadas do
 * fonte, não copiadas: guarda nova no send_message que não chegue à foto
 * reprova aqui sem ninguém lembrar de atualizar uma lista.
 */
function chavesDoSendMessage(): string[] {
  const bloco = trecho("const beforeSendArgs = {", "let chain = await runBeforeSend(beforeSendArgs);");
  const diretas = [...bloco.matchAll(/^\s{12}(\w+)(?=[,:])/gm)].map((m) => m[1]!);
  // Só no nível do objeto (12 espaços): o `voice` espalhado lá dentro do
  // `channel.send` das bolhas é do canal, não da cadeia — e foto não tem voz.
  const espalhadas = [...bloco.matchAll(/^ {12}\.\.\.\([^?]+\?\s*\{\s*(\w+):/gm)].map((m) => m[1]!);
  return [...new Set([...diretas, ...espalhadas])];
}

describe("send_image — a tool só existe para quem tem foto", () => {
  it("some do objeto de tools quando o acervo do agente não tem foto", () => {
    const i = FONTE.indexOf("delete rawTools.send_image;");
    expect(i).toBeGreaterThan(-1);
    expect(FONTE.slice(i - 200, i)).toMatch(/agentConfig\?\.temFotosNoAcervo !== true/);
  });

  it("não é ferramenta só-leitura — enviar foto é falar com o lead", () => {
    expect(READ_ONLY_TOOLS as readonly string[]).not.toContain("send_image");
  });
});

describe("send_image — o execute não pode virar rota de fuga dos guardrails", () => {
  it("a foto é resolvida pelo código, entre os materiais DESTE agente", () => {
    expect(corpoDoExecute()).toMatch(
      /resolverFotoDoAgente\(pool, \{[\s\S]*knowledgeSourceIds: agentConfig\?\.knowledgeSourceIds \?\? \[\][\s\S]*foto,/,
    );
  });

  it("foto desconhecida/indisponível vira erro de ENSINO, sem tocar a cadeia", () => {
    const corpo = corpoDoExecute();
    const erro = corpo.indexOf("if (!resolvida.ok)");
    expect(erro).toBeGreaterThan(-1);
    expect(erro).toBeLessThan(corpo.indexOf("runBeforeSend("));
    expect(corpo.slice(erro, erro + 200)).toMatch(/return \{ ok: false, error: \{ code: resolvida\.code/);
  });

  it("⭐ a LEGENDA passa pela cadeia before_send como corpo", () => {
    expect(argsDaCadeia()).toMatch(/\bbody: legenda,/);
  });

  it("⭐ a cadeia recebe OS MESMOS argumentos do send_message", () => {
    const chaves = chavesDoSendMessage();
    // Guarda de vacuidade: a extração achou as guardas que importam.
    for (const essencial of [
      "lgpd",
      "optedOutThisTurn",
      "enforceInternalVocabulary",
      "coordenacao",
      "disclosureMode",
      "casesEnabled",
      "hasOpenCase",
      "openedCaseThisTurn",
      "send",
    ]) {
      expect(chaves, `extração não achou ${essencial}`).toContain(essencial);
    }
    const args = argsDaCadeia();
    for (const chave of chaves) {
      expect(args, `send_image não passa \`${chave}\` à cadeia`).toMatch(new RegExp(`\\b${chave}\\b`));
    }
  });

  it("a rede de vocabulário interno vale: a legenda é texto do modelo", () => {
    expect(argsDaCadeia()).toMatch(/enforceInternalVocabulary: true/);
  });

  it("o veto da cadeia devolve erro ao modelo em vez de enviar", () => {
    expect(corpoDoExecute()).toMatch(/chain\.status === 'vetoed'[\s\S]*return \{ ok: false/);
  });

  it("⭐ o envio leva a foto ao canal, com a legenda final como corpo", () => {
    expect(corpoDoExecute()).toMatch(/channel\.send\(\{[\s\S]*body: finalBody,[\s\S]*imagem,/);
  });

  it("o envio gasta o MESMO seq do ledger e conta a foto no teto próprio", () => {
    const send = corpoDoExecute().slice(corpoDoExecute().indexOf("send: (finalBody: string) => {"));
    expect(send).toMatch(/seq \+= 1;\s*imagensNoTurno \+= 1;/);
  });

  it("anda na fila do turno — a ordem entre texto e foto vale", () => {
    expect(corpoDoExecute()).toMatch(/execute: emOrdem\(/);
    expect(corpoDoExecute()).toMatch(/\}, filaDeEnvioDoTurno\),/);
  });
});

describe("send_image — teto de fotos SEPARADO do de textos", () => {
  it("os defaults: 3 textos e 4 fotos", () => {
    expect(DEFAULT_MAX_SENDS_PER_TURN).toBe(3);
    expect(DEFAULT_MAX_IMAGES_PER_TURN).toBe(4);
  });

  it("⭐ a foto confere o próprio contador, não o seq", () => {
    const corpo = corpoDoExecute();
    expect(corpo).toMatch(/if \(imagensNoTurno >= maxImagesPerTurn\)/);
    expect(corpo).toMatch(/code: 'max_images_per_turn'/);
    expect(corpo).not.toMatch(/seq >= maxSendsPerTurn/);
  });

  it("⭐ textos contam seq MENOS as fotos — foto não gasta o teto de texto", () => {
    expect(FONTE).toMatch(/const textosNoTurno = \(\): number => seq - imagensNoTurno;/);
    // Nenhum envio de texto confere o seq cru: senão 3 fotos calariam a resposta.
    expect(FONTE).not.toMatch(/if \(seq >= maxSendsPerTurn\)/);
    for (const [inicio, fim] of [
      ["    send_template: tool({", "    search_knowledge: tool({"],
      ["    send_options: tool({", "    send_message: tool({"],
      ["    send_message: tool({", "    update_lead_state: tool({"],
    ] as const) {
      expect(trecho(inicio, fim), inicio).toMatch(/if \(textosNoTurno\(\) >= maxSendsPerTurn\)/);
    }
  });

  it("o knob vem do env, como o de textos", () => {
    const deps = fs.readFileSync(path.join(process.cwd(), "lib/agent-engine/agent/deps-do-turno.ts"), "utf8");
    expect(deps).toMatch(/maxImagesPerTurn: env\.MAX_IMAGES_PER_TURN/);
    expect(FONTE).toMatch(/deps\.knobs\.maxImagesPerTurn \?\? DEFAULT_MAX_IMAGES_PER_TURN/);
  });
});

describe("send_image — o contrato que o modelo vê", () => {
  const schema = AGENT_TOOL_DEFS.send_image.inputSchema;

  it("aceita a chamada bem-formada", () => {
    expect(schema.safeParse({ foto: "foto-1a2b3c4d", legenda: "Essa é a cor Areia!" }).success).toBe(true);
  });

  it("legenda é obrigatória e cabe no limite de legenda do WhatsApp", () => {
    expect(schema.safeParse({ foto: "foto-1a2b3c4d" }).success).toBe(false);
    expect(schema.safeParse({ foto: "foto-1a2b3c4d", legenda: "" }).success).toBe(false);
    expect(schema.safeParse({ foto: "foto-1a2b3c4d", legenda: "a".repeat(1025) }).success).toBe(false);
    expect(schema.safeParse({ foto: "foto-1a2b3c4d", legenda: "a".repeat(1024) }).success).toBe(true);
  });

  it("foto é obrigatória", () => {
    expect(schema.safeParse({ legenda: "oi" }).success).toBe(false);
    expect(schema.safeParse({ foto: "", legenda: "oi" }).success).toBe(false);
  });

  it("a descrição diz de onde vem a foto, uma por chamada, e proíbe inventar", () => {
    const d = AGENT_TOOL_DEFS.send_image.description;
    expect(d).toMatch(/campo "foto"/);
    expect(d).toMatch(/search_knowledge/);
    expect(d).toMatch(/NUNCA invente/);
    expect(d).toMatch(/Uma foto por chamada/);
    expect(d).toMatch(/legenda é obrigatória/);
  });

  it("a descrição do search_knowledge NÃO mudou — mexer nela invalida o cache de todos os agentes", () => {
    expect(AGENT_TOOL_DEFS.search_knowledge.description).not.toMatch(/foto/i);
  });
});
