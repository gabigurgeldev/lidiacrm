import { describe, expect, it } from "vitest";

import { nomeObservadoDaSessao } from "./nome-observado";

const WORKING = "WORKING";

describe("nomeObservadoDaSessao", () => {
  it("adota o pushName quando a sessão está WORKING e a coluna está vazia", () => {
    expect(
      nomeObservadoDaSessao({
        pushName: "Gabriel Gurgel",
        jid: "559481004900@c.us",
        statusAoVivo: WORKING,
        gravado: null,
      }),
    ).toBe("Gabriel Gurgel");
  });

  it("NÃO sobrescreve um nome já escolhido — é a regra inversa à do número", () => {
    // O número é fato do aparelho e se corrige; o nome é escolha de quem opera.
    // Sobrescrever a cada health check apagaria o rótulo digitado, de 5 em 5 min.
    expect(
      nomeObservadoDaSessao({
        pushName: "Gabriel Gurgel",
        jid: "559481004900@c.us",
        statusAoVivo: WORKING,
        gravado: "Vendas",
      }),
    ).toBe("Vendas");
  });

  it("trata string vazia como vazio, não como nome escolhido", () => {
    expect(
      nomeObservadoDaSessao({
        pushName: "Suporte",
        statusAoVivo: WORKING,
        gravado: "   ",
      }),
    ).toBe("Suporte");
  });

  it.each(["FAILED", "STOPPED", "SCAN_QR_CODE", "STARTING", "", null, undefined])(
    "ignora o pushName fora de WORKING (status=%s)",
    (status) => {
      // O `me` do WAHA é o do último pareamento que vingou e segue sendo servido
      // com a sessão fora do ar — medido: duas sessões FAILED devolvendo o mesmo
      // `me`. Fora de WORKING isso é eco, não observação.
      expect(
        nomeObservadoDaSessao({
          pushName: "Gabriel Gurgel",
          statusAoVivo: status,
          gravado: null,
        }),
      ).toBeNull();
    },
  );

  it("aceita o status em caixa baixa (o transporte não promete caixa)", () => {
    expect(
      nomeObservadoDaSessao({ pushName: "Clínica", statusAoVivo: "working", gravado: null }),
    ).toBe("Clínica");
  });

  it("colapsa espaço e quebra de linha — pushName é texto livre do celular", () => {
    expect(
      nomeObservadoDaSessao({
        pushName: "  Gabriel \n\t  Gurgel  ",
        statusAoVivo: WORKING,
        gravado: null,
      }),
    ).toBe("Gabriel Gurgel");
  });

  it("recusa pushName que é só o próprio telefone", () => {
    // Não acrescenta nada ao fallback `display_name ?? phone_number` que já
    // existe em health.ts, e sujaria a coluna de ESCOLHA com um fato.
    expect(
      nomeObservadoDaSessao({
        pushName: "+55 94 8100-4900",
        jid: "559481004900@c.us",
        statusAoVivo: WORKING,
        gravado: null,
      }),
    ).toBeNull();
  });

  it("mantém um nome que apenas CONTÉM dígitos", () => {
    expect(
      nomeObservadoDaSessao({
        pushName: "Loja 2",
        jid: "559481004900@c.us",
        statusAoVivo: WORKING,
        gravado: null,
      }),
    ).toBe("Loja 2");
  });

  it("corta em 80 — o teto que createChannelSchema aceita", () => {
    const saida = nomeObservadoDaSessao({
      pushName: "x".repeat(200),
      statusAoVivo: WORKING,
      gravado: null,
    });
    expect(saida).toHaveLength(80);
  });

  it.each([null, undefined, "", "   "])("sem pushName utilizável (%s), devolve o gravado", (p) => {
    expect(nomeObservadoDaSessao({ pushName: p, statusAoVivo: WORKING, gravado: null })).toBeNull();
  });
});
