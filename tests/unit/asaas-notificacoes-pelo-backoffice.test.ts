/**
 * O ASAAS SE CALA QUANDO QUEM AVISA É O BACK OFFICE — E SÓ NESSE CASO.
 *
 * Com o Back Office de afiliados ligado, é ele quem manda o aviso de cobrança
 * ao cliente pelo WhatsApp (`invoice.updated`, `lib/backoffice/saida.ts`). O
 * Asaas avisando junto seria o mesmo aviso duas vezes. Sem o Back Office (o
 * self-host comum), calar o Asaas deixaria o cliente sem aviso nenhum — por isso
 * as duas direções são provadas aqui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  ASAAS_API_KEY: "aact_hmlg_teste",
  ASAAS_AMBIENTE: "sandbox",
  BACKOFFICE_URL: "",
  BACKOFFICE_API_KEY: "",
  NEXT_PUBLIC_APP_URL: "https://crm.test",
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { atualizarCliente, criarCliente, desligarNotificacoesDoCliente } from "@/lib/billing/asaas";

const titular = {
  nome: "Fulana",
  cpfCnpj: "000.000.000-00",
  email: "fulana@exemplo.test",
  telefone: "(11) 90000-0000",
  cep: "01000-000",
  numero: "10",
};

const fetchMock = vi.fn();
const corpo = (i = 0) => JSON.parse(fetchMock.mock.calls[i]![1].body as string) as Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({ id: "cus_1" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  envMock.BACKOFFICE_URL = "";
  envMock.BACKOFFICE_API_KEY = "";
});

describe("notificationDisabled no cliente do Asaas", () => {
  it("Back Office ligado: cliente novo e cliente atualizado nascem calados", async () => {
    envMock.BACKOFFICE_URL = "https://bo.test";
    envMock.BACKOFFICE_API_KEY = "bo_live_x";
    await criarCliente(titular, "org-1");
    await atualizarCliente("cus_1", titular);
    expect(corpo(0).notificationDisabled).toBe(true);
    expect(corpo(1).notificationDisabled).toBe(true);
  });

  it("sem Back Office: o campo nem vai — o Asaas segue como o operador deixou", async () => {
    await criarCliente(titular, "org-1");
    await atualizarCliente("cus_1", titular);
    // `false` explícito reativaria, a cada checkout, a notificação desligada à mão no painel do Asaas.
    expect(corpo(0)).not.toHaveProperty("notificationDisabled");
    expect(corpo(1)).not.toHaveProperty("notificationDisabled");
  });

  it("o acerto dos clientes antigos mexe SÓ no notificationDisabled", async () => {
    await desligarNotificacoesDoCliente("cus_9");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api-sandbox.asaas.com/v3/customers/cus_9");
    expect(init.method).toBe("PUT");
    expect(corpo(0)).toEqual({ notificationDisabled: true });
  });
});
