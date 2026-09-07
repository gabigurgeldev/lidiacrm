/**
 * O QUADRO DIZ O QUE FAZ — cartão, linha e cópia.
 *
 * Três defeitos de leitura, os três medidos no editor de produção antes desta
 * leva:
 *
 *   1. O cartão mostrava o `type` cru (`logic.wait`, `whatsapp.send_to_lead`).
 *      Cinco mensagens seguidas eram cinco cartões idênticos.
 *   2. As linhas eram todas iguais: um `logic.if` com quatro regras produzia
 *      quatro fios sem nome saindo do mesmo bloco.
 *   3. Não havia como copiar um bloco já configurado.
 *
 * O que estes testes fixam é o COMPORTAMENTO de cada peça, e sobretudo os
 * modos de falha silenciosos: config meio escrita não pode derrubar o quadro,
 * a linha não pode carregar rótulo desatualizado, e a cópia não pode
 * compartilhar array com o original.
 */
import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { decorarArestas, duplicarNo } from "@/app/app/flows/[id]/_components/quadro";
import {
  aplicarValores,
  ESPERA_POR_UNIDADE,
  encurtar,
  PRAZO_POR_UNIDADE,
  resumoDoBloco,
} from "@/app/app/flows/[id]/_components/resumoDoBloco";
import { configExemploDoTipo } from "@/lib/flow-engine/node-examples";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { tiposRegistrados } from "@/lib/flow-engine/registry";
import { DICIONARIO } from "@/lib/i18n/dicionario";

// ─────────────────────────── o resumo do cartão ───────────────────────────

/** Como a tela monta a frase: traduz a chave, DEPOIS substitui os valores. */
function frase(tipo: string, config: Record<string, unknown>): string | null {
  const r = resumoDoBloco(tipo, config);
  return r === null ? null : aplicarValores(r.chave, r.valores);
}

describe("o cartão diz o que o bloco faz", () => {
  it("⭐ a espera mostra o tempo, na maior unidade inteira", () => {
    expect(frase("logic.wait", { duracao_ms: 300_000 })).toBe("Espera 5 minutos");
    expect(frase("logic.wait", { duracao_ms: 172_800_000 })).toBe("Espera 2 dias");
    // 90s não vira "1,5 minutos": meia unidade lê pior que a unidade menor.
    expect(frase("logic.wait", { duracao_ms: 90_000 })).toBe("Espera 90 segundos");
  });

  it("⭐ a mensagem mostra o texto, que é o que distingue uma da outra", () => {
    expect(frase("whatsapp.send_to_lead", { tipo: "texto", texto: "Oi, tudo bem?" })).toBe(
      "“Oi, tudo bem?”",
    );
  });

  it("⭐ bloco com recurso não escolhido AVISA — não espera o botão Publicar", () => {
    // Os três blocos que nascem com o UUID nulo de propósito (node-examples.ts).
    expect(frase("flow.call", configExemploDoTipo("flow.call"))).toBe("Falta escolher o fluxo");
    expect(frase("whatsapp.bulk_send", configExemploDoTipo("whatsapp.bulk_send"))).toBe(
      "Falta escolher o número",
    );
    expect(frase("routing.fixed_order", configExemploDoTipo("routing.fixed_order"))).toBe(
      "Falta montar a fila",
    );
  });

  it("⭐ config meio escrita não lança — o quadro renderiza DURANTE a edição", () => {
    const lixo: Record<string, unknown>[] = [
      {},
      { duracao_ms: "cinco" },
      { saidas: "isto devia ser lista" },
      { opcoes: [null, 7, { label: 42 }] },
      { palavras: [null, "", "  "] },
      { destinatario: "texto onde devia ser objeto" },
      { tags: [1, 2, 3] },
    ];
    for (const tipo of tiposRegistrados()) {
      for (const config of lixo) {
        expect(() => resumoDoBloco(tipo, config)).not.toThrow();
      }
    }
  });

  it("⭐ tipo sem resumo cai em `null`, e a tela usa a descrição do registry", () => {
    expect(resumoDoBloco("tipo.que.nao.existe", {})).toBeNull();
    // `logic.merge` não tem config: não há o que resumir, e forçar uma frase
    // seria repetir o rótulo do cartão logo acima dela.
    expect(resumoDoBloco("logic.merge", {})).toBeNull();
  });

  it("texto longo é cortado sem partir palavra, e o corte aparece", () => {
    const s = encurtar("uma frase bastante comprida que passa do limite estabelecido aqui", 30);
    expect(s.length).toBeLessThanOrEqual(31);
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toMatch(/\s…$/u);
    // Curta passa inteira, sem reticência decorativa.
    expect(encurtar("curta", 30)).toBe("curta");
  });

  it("o menu e o decidir listam o que a pessoa escreveu", () => {
    expect(frase("logic.choice_menu", configExemploDoTipo("logic.choice_menu"))).toBe(
      "Espera a escolha: Sim, Não",
    );
    expect(frase("logic.if", configExemploDoTipo("logic.if"))).toBe("Se Score acima de 70");
  });
});

describe("toda chave de resumo tem espanhol", () => {
  /**
   * O gate genérico (`i18n-espanhol-cobre-a-tela`) varre `t("literal")` no AST
   * e NÃO alcança `t(variavel)` — que é exatamente como o cartão consome estas
   * chaves. Sem esta cerca, uma chave nova aqui sairia em português no meio do
   * espanhol e nenhum teste ficaria vermelho.
   *
   * As chaves são colhidas RODANDO a função sobre os exemplos e sobre as
   * variações que mudam de frase, e não de uma lista escrita à mão ao lado —
   * lista escrita à mão diverge no dia em que alguém acrescenta um `case`.
   */
  function todasAsChaves(): string[] {
    garantirNosRegistrados();
    const variacoes: Record<string, Record<string, unknown>[]> = {
      "trigger.keyword": [{ palavras: [] }, { palavras: ["oi"], modo: "exata" }],
      "logic.if": [{ saidas: [] }, { saidas: [{ label: "a" }, { label: "b" }] }],
      "logic.fork": [{ ramos: [{ label: "a" }], modo: "primeira" }],
      "logic.loop": [{ lista: "vars.x" }],
      "logic.await_event": [{ evento: "x" }],
      "logic.choice_menu": [{ opcoes: [] }],
      "flow.call": [{ fluxo_id: "11111111-1111-1111-1111-111111111111" }],
      "crm.owner_responded": [{ contar_a_partir_de: "desde_o_ultimo_no" }],
      "routing.fixed_order": [{ ordem: ["11111111-1111-1111-1111-111111111111"] }],
      "whatsapp.send_to_lead": [{ tipo: "imagem" }],
      "whatsapp.notify_user": [
        { destinatario: { tipo: "dono_do_lead" } },
        { destinatario: { tipo: "numero_fixo" }, mensagem: "oi" },
      ],
      "whatsapp.bulk_send": [
        { canal_id: "11111111-1111-1111-1111-111111111111", audiencia: "contatos" },
      ],
    };
    const chaves = new Set<string>();
    for (const tipo of tiposRegistrados()) {
      for (const config of [configExemploDoTipo(tipo), ...(variacoes[tipo] ?? [])]) {
        const r = resumoDoBloco(tipo, config);
        if (r !== null) chaves.add(r.chave);
      }
    }
    return [...chaves];
  }

  it("⭐ nenhuma frase do cartão cai no português por falta de tradução", () => {
    const chaves = todasAsChaves();
    // A sonda tem de estar VENDO alguma coisa: um `resumoDoBloco` que passasse
    // a devolver `null` sempre deixaria este teste verde e vazio.
    expect(chaves.length).toBeGreaterThan(12);
    expect(chaves.filter((k) => DICIONARIO[k]?.es === undefined)).toEqual([]);
  });

  it("⭐ TODA frase de tempo, e não só as que o resumo por acaso produziu", () => {
    // Enumeração completa, não amostra: é a razão de as frases estarem escritas
    // uma a uma em vez de montadas com `+` — ver o comentário dos dois mapas.
    const frases = [...Object.values(ESPERA_POR_UNIDADE), ...Object.values(PRAZO_POR_UNIDADE)];
    expect(frases).toHaveLength(8);
    expect(frases.filter((k) => DICIONARIO[k]?.es === undefined)).toEqual([]);
  });
});

// ─────────────────────────── as linhas do quadro ───────────────────────────

function no(id: string, extra: Partial<Record<string, unknown>> = {}): Node {
  return {
    id,
    type: "fluxo",
    position: { x: 0, y: 0 },
    data: { rotulo: id, tipo: "logic.if", categoria: "logic", branches: [], ...extra },
  };
}

describe("a linha diz de qual saída saiu", () => {
  const origem = no("a", {
    branches: [
      { id: "s1", label: "Score acima de 70", kind: "match" },
      { id: "else", label: "Senão", kind: "fallback" },
    ],
  });
  const nos = [origem, no("b")];

  it("⭐ o rótulo da linha é o do RAMO, e traduzido", () => {
    const [linha] = decorarArestas(
      nos,
      [{ id: "e1", source: "a", target: "b", sourceHandle: "s1" }],
      (s) => `es:${s}`,
    );
    expect(linha!.label).toBe("es:Score acima de 70");
  });

  it("⭐ bloco de saída ÚNICA não ganha rótulo — seria a mesma palavra em toda linha", () => {
    const soUma = no("c", { branches: [{ id: "else", label: "Segue", kind: "fallback" }] });
    const [linha] = decorarArestas(
      [soUma, no("b")],
      [{ id: "e1", source: "c", target: "b", sourceHandle: "else" }],
      (s) => s,
    );
    expect(linha!.label).toBeUndefined();
  });

  it("⭐ a linha de EXCEÇÃO é tracejada; a de regra, não", () => {
    const comFalha = no("d", {
      branches: [
        { id: "ok", label: "Enviada", kind: "match" },
        { id: "falhou", label: "Não saiu", kind: "excecao" },
      ],
    });
    const linhas = decorarArestas(
      [comFalha, no("b")],
      [
        { id: "e1", source: "d", target: "b", sourceHandle: "ok" },
        { id: "e2", source: "d", target: "b", sourceHandle: "falhou" },
      ],
      (s) => s,
    );
    expect(linhas[0]!.style?.strokeDasharray).toBeUndefined();
    expect(linhas[1]!.style?.strokeDasharray).toBe("6 4");
  });

  it("a decoração NÃO inventa nem apaga campo do contrato salvo", () => {
    const bruta: Edge = { id: "e1", source: "a", target: "b", sourceHandle: "s1" };
    const [linha] = decorarArestas(nos, [bruta], (s) => s);
    expect(linha!.id).toBe("e1");
    expect(linha!.source).toBe("a");
    expect(linha!.target).toBe("b");
    expect(linha!.sourceHandle).toBe("s1");
  });

  it("linha cuja origem sumiu não derruba o desenho", () => {
    expect(() =>
      decorarArestas(nos, [{ id: "x", source: "fantasma", target: "b" }], (s) => s),
    ).not.toThrow();
  });
});

// ───────────────────────────── duplicar bloco ─────────────────────────────

describe("duplicar leva os ajustes junto", () => {
  const original = no("a", {
    tipo: "logic.if",
    config: { saidas: [{ id: "s1", label: "Score acima de 70" }] },
  });

  it("⭐ a cópia não COMPARTILHA a config com o original", () => {
    const copia = duplicarNo([original], "a", "novo")!;
    const cfgCopia = copia.data["config"] as { saidas: { label: string }[] };
    const cfgOriginal = (original.data as { config: { saidas: { label: string }[] } }).config;

    expect(cfgCopia.saidas[0]!.label).toBe("Score acima de 70");
    cfgCopia.saidas[0]!.label = "outra coisa";
    // Cópia rasa deixaria as duas apontando para o MESMO array, e editar a
    // regra da cópia mudaria a do original — no bloco que ninguém abriu.
    expect(cfgOriginal.saidas[0]!.label).toBe("Score acima de 70");
  });

  it("⭐ GATILHO não duplica: um fluxo tem um, e só um", () => {
    const gatilho = no("g", { categoria: "trigger", tipo: "trigger.lead_created" });
    expect(duplicarNo([gatilho], "g", "novo")).toBeNull();
  });

  it("⭐ a cópia nasce ao lado, nunca por cima do original", () => {
    const copia = duplicarNo([original], "a", "novo")!;
    expect(copia.position).not.toEqual(original.position);
    expect(copia.id).toBe("novo");
  });

  it("bloco inexistente devolve null em vez de lançar", () => {
    expect(duplicarNo([original], "nao-existe", "novo")).toBeNull();
  });
});
