import { describe, expect, it } from "vitest";

import { opcoesInterativasSchema } from "@/lib/schemas";

import { CAPACIDADES_POR_MODO, CHANNEL_CAPABILITIES } from "./capabilities";
import {
  formatoDasOpcoes,
  opcaoEscolhida,
  opcoesDaMetadata,
  respostaInterativaDaMetadata,
  textoDasOpcoes,
} from "./opcoes-interativas";

const SO_ENQUETE = { opcoesInterativas: { enquete: true, lista: false } };
const SO_LISTA = { opcoesInterativas: { enquete: false, lista: true } };
const AMBAS = { opcoesInterativas: { enquete: true, lista: true } };
const NENHUMA = { opcoesInterativas: { enquete: false, lista: false } };
const umaConversa = { grupo: false, quantidade: 3 };

describe("formatoDasOpcoes", () => {
  it("dá o formato pedido quando o canal desenha", () => {
    expect(formatoDasOpcoes(AMBAS, "enquete", umaConversa)).toBe("enquete");
    expect(formatoDasOpcoes(AMBAS, "lista", umaConversa)).toBe("lista");
  });

  it("automático prefere a enquete, que é a estável", () => {
    expect(formatoDasOpcoes(AMBAS, "automatico", umaConversa)).toBe("enquete");
    expect(formatoDasOpcoes(SO_LISTA, "automatico", umaConversa)).toBe("lista");
  });

  it("rebaixa para o OUTRO interativo antes de cair em texto", () => {
    expect(formatoDasOpcoes(SO_LISTA, "enquete", umaConversa)).toBe("lista");
    expect(formatoDasOpcoes(SO_ENQUETE, "lista", umaConversa)).toBe("enquete");
  });

  it("texto numerado é o piso — canal sem nada nunca falha", () => {
    expect(formatoDasOpcoes(NENHUMA, "enquete", umaConversa)).toBe("texto");
    expect(formatoDasOpcoes(NENHUMA, "automatico", umaConversa)).toBe("texto");
  });

  it("lista nunca sai em grupo, nem como segunda opção", () => {
    const grupo = { grupo: true, quantidade: 3 };
    expect(formatoDasOpcoes(AMBAS, "lista", grupo)).toBe("enquete");
    expect(formatoDasOpcoes(SO_LISTA, "automatico", grupo)).toBe("texto");
  });

  it("menos de 2 ou mais de 10 opções vira texto", () => {
    expect(formatoDasOpcoes(AMBAS, "enquete", { grupo: false, quantidade: 1 })).toBe("texto");
    expect(formatoDasOpcoes(AMBAS, "enquete", { grupo: false, quantidade: 11 })).toBe("texto");
  });

  it("matriz real: QR desenha enquete, oficial desenha lista, intermediados caem em texto", () => {
    expect(formatoDasOpcoes(CHANNEL_CAPABILITIES.waha, "automatico", umaConversa)).toBe("enquete");
    expect(formatoDasOpcoes(CHANNEL_CAPABILITIES.meta_cloud, "enquete", umaConversa)).toBe("lista");
    expect(formatoDasOpcoes(CHANNEL_CAPABILITIES.zernio, "lista", umaConversa)).toBe("texto");
    expect(formatoDasOpcoes(CHANNEL_CAPABILITIES.stevo, "lista", umaConversa)).toBe("texto");
    for (const caps of Object.values(CAPACIDADES_POR_MODO.stevo ?? {})) {
      expect(formatoDasOpcoes(caps, "automatico", umaConversa)).toBe("texto");
    }
  });
});

describe("textoDasOpcoes", () => {
  it("é a pergunta com as opções numeradas embaixo", () => {
    expect(
      textoDasOpcoes({
        pergunta: "Qual setor?",
        opcoes: [
          { id: "a", label: "Suporte" },
          { id: "b", label: "Financeiro" },
        ],
      }),
    ).toBe("Qual setor?\n\n1️⃣ Suporte\n2️⃣ Financeiro");
  });
});

describe("opcaoEscolhida", () => {
  const opcoes = [
    { id: "o1", label: "Agendar consulta" },
    { id: "o2", label: "Agendar exame" },
    { id: "o3", label: "Falar com a recepção" },
  ];

  it("o id ganha do rótulo (a lista devolve rowId)", () => {
    expect(opcaoEscolhida(opcoes, { id: "o3", rotulo: "qualquer coisa" })?.id).toBe("o3");
  });

  it("casa o rótulo sem acento e sem caixa (a enquete devolve o texto)", () => {
    expect(opcaoEscolhida(opcoes, { rotulo: "FALAR COM A RECEPCAO" })?.id).toBe("o3");
  });

  it("aceita rótulo cortado pelo canal só quando o começo é único", () => {
    expect(opcaoEscolhida(opcoes, { rotulo: "Falar com a" })?.id).toBe("o3");
    expect(opcaoEscolhida(opcoes, { rotulo: "Agendar" })).toBeNull();
  });

  it("nada reconhecível → null", () => {
    expect(opcaoEscolhida(opcoes, { rotulo: "" })).toBeNull();
    expect(opcaoEscolhida(opcoes, { id: "zz", rotulo: "outra" })).toBeNull();
  });
});

describe("metadata", () => {
  it("opcoesDaMetadata lê o que gravamos e ignora o resto", () => {
    const meta = {
      opcoes: { formato: "enquete", pergunta: "P?", opcoes: [{ id: "a", label: "A" }, { lixo: 1 }] },
    };
    expect(opcoesDaMetadata(meta)).toEqual({ formato: "enquete", pergunta: "P?", opcoes: [{ id: "a", label: "A" }] });
    expect(opcoesDaMetadata({ opcoes: { formato: "botao" } })).toBeNull();
    expect(opcoesDaMetadata(null)).toBeNull();
  });

  it("respostaInterativaDaMetadata exige formato e rótulo", () => {
    expect(
      respostaInterativaDaMetadata({
        resposta_interativa: { formato: "lista", opcao_label: "A", opcao_id: "a" },
      }),
    ).toEqual({ formato: "lista", mensagem_origem_id: null, pergunta: null, opcao_id: "a", opcao_label: "A" });
    expect(respostaInterativaDaMetadata({ resposta_interativa: { formato: "lista" } })).toBeNull();
  });
});

describe("opcoesInterativasSchema", () => {
  const base = { pergunta: "Qual?", opcoes: [{ id: "a", label: "Sim" }, { id: "b", label: "Não" }] };

  it("aceita o caso comum", () => {
    expect(opcoesInterativasSchema.safeParse(base).success).toBe(true);
  });

  it("recusa rótulos iguais (resposta ambígua), mesmo com acento/caixa diferentes", () => {
    const r = opcoesInterativasSchema.safeParse({
      ...base,
      opcoes: [{ id: "a", label: "Não" }, { id: "b", label: "nao" }],
    });
    expect(r.success).toBe(false);
  });

  it("recusa ids repetidos, uma opção só e mais de 10", () => {
    expect(
      opcoesInterativasSchema.safeParse({ ...base, opcoes: [{ id: "a", label: "X" }, { id: "a", label: "Y" }] }).success,
    ).toBe(false);
    expect(opcoesInterativasSchema.safeParse({ ...base, opcoes: [{ id: "a", label: "X" }] }).success).toBe(false);
    const onze = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: `Opção ${i}` }));
    expect(opcoesInterativasSchema.safeParse({ ...base, opcoes: onze }).success).toBe(false);
  });
});
