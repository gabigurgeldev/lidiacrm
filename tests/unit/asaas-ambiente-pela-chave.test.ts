/**
 * A CHAVE DO ASAAS DECIDE O AMBIENTE.
 *
 * Só `ASAAS_AMBIENTE=producao` (exato) mandava para a produção. `produção`,
 * `production`, `prod` — ou simplesmente esquecer de trocar o rótulo junto com
 * a chave — caíam no sandbox em silêncio: a chave de produção levava 401 lá, e
 * o checkout dizia "cartão recusado". Na virada para produção, é o primeiro
 * erro que acontece.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { ASAAS_API_KEY: "", ASAAS_AMBIENTE: "sandbox" } }));

import { ambienteDivergente, ambienteDoAsaas, urlBaseDoAsaas } from "@/lib/billing/asaas";

describe("ambiente do Asaas", () => {
  it.each([
    ["aact_prod_abc", "sandbox", "producao"],
    ["$aact_prod_abc", "", "producao"],
    ["aact_hmlg_abc", "producao", "sandbox"],
  ])("chave %s com rótulo %j → %s (a chave manda)", (chave, rotulo, esperado) => {
    expect(ambienteDoAsaas(chave, rotulo)).toBe(esperado);
  });

  it.each(["producao", "produção", "Production", " prod "])(
    "sem prefixo reconhecível, o rótulo %j vale produção",
    (rotulo) => {
      expect(ambienteDoAsaas("chave-sem-prefixo", rotulo)).toBe("producao");
    },
  );

  it("sem prefixo e rótulo qualquer outro: sandbox (o padrão seguro)", () => {
    expect(ambienteDoAsaas("x", "homologacao")).toBe("sandbox");
  });

  it("URL de cada ambiente", () => {
    expect(urlBaseDoAsaas("producao")).toBe("https://api.asaas.com/v3");
    expect(urlBaseDoAsaas("sandbox")).toBe("https://api-sandbox.asaas.com/v3");
  });

  it("acusa rótulo que contradiz a chave (vira aviso no log)", () => {
    expect(ambienteDivergente("aact_prod_x", "sandbox")).toBe(true);
    expect(ambienteDivergente("aact_prod_x", "producao")).toBe(false);
    expect(ambienteDivergente("", "producao")).toBe(false);
  });
});
