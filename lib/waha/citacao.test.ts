import { describe, expect, it } from "vitest";

import { idDaMensagemCitada } from "@/lib/waha/citacao";
import type { WahaPayload } from "@/lib/waha/envelope";

/**
 * "Gostei desse" em cima de uma foto — o id da foto citada tem que sair do
 * payload. Formas reais do WAHA: o campo normalizado `replyTo` e o protocolo
 * cru `contextInfo.stanzaId` (NOWEB), este último às vezes dentro de um
 * envelope de mensagem temporária.
 */
describe("idDaMensagemCitada", () => {
  it("lê `replyTo.id` (campo normalizado do WAHA)", () => {
    expect(idDaMensagemCitada({ replyTo: { id: "3EB0A1B2C3D4E5F6" } } as WahaPayload)).toBe("3EB0A1B2C3D4E5F6");
  });

  it("reduz id composto ao bare — é o bare que o banco casa", () => {
    expect(
      idDaMensagemCitada({ replyTo: { id: "true_5594999999999@c.us_3EB0A1B2C3D4E5F6" } } as WahaPayload),
    ).toBe("3EB0A1B2C3D4E5F6");
  });

  it("lê `contextInfo.stanzaId` do protocolo cru (NOWEB)", () => {
    const p = {
      _data: {
        message: {
          extendedTextMessage: { text: "Gostei desse", contextInfo: { stanzaId: "2A1B890FB8AA87730CBC" } },
        },
      },
    } as WahaPayload;
    expect(idDaMensagemCitada(p)).toBe("2A1B890FB8AA87730CBC");
  });

  it("atravessa o envelope de mensagem temporária", () => {
    const p = {
      _data: {
        message: {
          ephemeralMessage: {
            message: { extendedTextMessage: { text: "esse", contextInfo: { stanzaId: "ABCDEF123456" } } },
          },
        },
      },
    } as WahaPayload;
    expect(idDaMensagemCitada(p)).toBe("ABCDEF123456");
  });

  it("mensagem sem citação → null", () => {
    expect(idDaMensagemCitada({ body: "oi", _data: { message: { conversation: "oi" } } } as WahaPayload)).toBeNull();
    expect(idDaMensagemCitada({} as WahaPayload)).toBeNull();
  });

  it("id com caractere de filtro é recusado — o valor vai para um filtro do PostgREST", () => {
    // `,` e `(` reescreveriam o `.or(...)` de quem resolve a original.
    expect(idDaMensagemCitada({ replyTo: { id: "ABC123,id.neq.0" } } as WahaPayload)).toBeNull();
    expect(idDaMensagemCitada({ replyTo: { id: "ABC(123)" } } as WahaPayload)).toBeNull();
  });
});
