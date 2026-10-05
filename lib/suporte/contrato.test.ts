import { describe, expect, it } from "vitest";

import { assinarSuporteV1, cabecalhosAssinados, conferirSuporteV1, textoAssinado } from "./contrato";

/**
 * VETOR DE TESTE do Contrato de Suporte v1. Está repetido, byte a byte, em
 * `docs/integracoes/contrato-de-suporte-v1.md` — é o que os outros sistemas
 * copiam para provar que assinam igual. Mudar aqui exige mudar lá (e em todo
 * sistema que já implementou): é quebra de contrato.
 */
const VETOR = {
  segredo: "segredo-de-teste",
  timestamp: "1760000000",
  metodo: "POST",
  caminhoComQuery: "/suporte/v1/contas/org-123/acoes/reconectar_canal",
  corpo: '{"canal":"1"}',
  assinatura: "sha256=08571e48e073516b414bf0f198fb206c4c217ba433ecdea5b1b6720e1b75f32a",
};

describe("Contrato de Suporte v1 — assinatura", () => {
  it("o texto assinado inclui método e caminho", () => {
    expect(textoAssinado(VETOR)).toBe(
      '1760000000.POST./suporte/v1/contas/org-123/acoes/reconectar_canal.{"canal":"1"}',
    );
  });

  it("vetor de teste (o mesmo do doc)", () => {
    expect(assinarSuporteV1(VETOR.segredo, VETOR)).toBe(VETOR.assinatura);
  });

  it("confere a própria assinatura dentro da janela", () => {
    const agoraMs = Number(VETOR.timestamp) * 1000 + 10_000;
    expect(conferirSuporteV1({ ...VETOR, assinatura: VETOR.assinatura, agoraMs })).toEqual({ ok: true });
  });

  it("a mesma assinatura NÃO vale para outro caminho (conta B)", () => {
    const agoraMs = Number(VETOR.timestamp) * 1000;
    expect(
      conferirSuporteV1({
        ...VETOR,
        caminhoComQuery: "/suporte/v1/contas/org-999/acoes/reconectar_canal",
        agoraMs,
      }),
    ).toEqual({ ok: false, motivo: "invalida" });
  });

  it("a mesma assinatura NÃO vale para outro método", () => {
    const agoraMs = Number(VETOR.timestamp) * 1000;
    expect(conferirSuporteV1({ ...VETOR, metodo: "GET", agoraMs })).toEqual({ ok: false, motivo: "invalida" });
  });

  it("fora da janela de 5 minutos expira", () => {
    const agoraMs = (Number(VETOR.timestamp) + 301) * 1000;
    expect(conferirSuporteV1({ ...VETOR, agoraMs })).toEqual({ ok: false, motivo: "expirada" });
  });

  it("sem segredo configurado recusa", () => {
    expect(conferirSuporteV1({ ...VETOR, segredo: "" })).toEqual({ ok: false, motivo: "sem_segredo" });
  });

  it("os cabeçalhos do cliente conferem do lado do servidor", () => {
    const agoraMs = Date.now();
    const h = cabecalhosAssinados({
      segredo: "s",
      metodo: "GET",
      url: "https://crm.exemplo.com/suporte/v1/contas/a/diagnostico?x=1",
      corpo: null,
      requestId: "r1",
      agoraMs,
    });
    expect(
      conferirSuporteV1({
        segredo: "s",
        timestamp: h["X-Suporte-Timestamp"] ?? null,
        assinatura: h["X-Suporte-Signature"] ?? null,
        metodo: "GET",
        caminhoComQuery: "/suporte/v1/contas/a/diagnostico?x=1",
        corpo: "",
        agoraMs,
      }),
    ).toEqual({ ok: true });
  });
});
