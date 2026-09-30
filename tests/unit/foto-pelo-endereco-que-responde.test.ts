/**
 * A FOTO É PERGUNTADA PELO ENDEREÇO QUE RESPONDE.
 *
 * Medido em produção (2026-09-29), mesmo contato, mesma conexão:
 * `5594984304355@c.us` (com o nono dígito, como o CRM grava) → sem foto;
 * `559484304355@c.us` (sem o nono) → foto; `<lid>@lid` → foto. Perguntar só pela
 * forma canônica deixava a maioria dos contatos na silhueta.
 */
import { describe, expect, it } from "vitest";

import { enderecosParaFoto } from "@/lib/contacts/avatar-do-contato";

describe("enderecosParaFoto", () => {
  it("⭐ celular BR: @lid primeiro, depois SEM o nono dígito, depois COM", () => {
    expect(
      enderecosParaFoto({ wa_identity: "phone:+5594984304355", wa_lid: "63105988067356" }),
    ).toEqual(["63105988067356@lid", "559484304355@c.us", "5594984304355@c.us"]);
  });

  it("sem lid: as duas formas do celular, a sem o nono primeiro", () => {
    expect(enderecosParaFoto({ wa_identity: "phone:+5594984304355", wa_lid: null })).toEqual([
      "559484304355@c.us",
      "5594984304355@c.us",
    ]);
  });

  it("fixo e estrangeiro: um endereço só — não inventa variante", () => {
    expect(enderecosParaFoto({ wa_identity: "phone:+553132345678" })).toEqual(["553132345678@c.us"]);
    expect(enderecosParaFoto({ wa_identity: "phone:+14155550123" })).toEqual(["14155550123@c.us"]);
  });

  it("identidade só por lid, e lid repetido não duplica a pergunta", () => {
    expect(enderecosParaFoto({ wa_identity: "lid:123", wa_lid: "123@lid" })).toEqual(["123@lid"]);
  });

  it("sem identidade nenhuma: nada a perguntar", () => {
    expect(enderecosParaFoto({ wa_identity: null, wa_lid: null })).toEqual([]);
  });
});
