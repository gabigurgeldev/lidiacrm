import { describe, expect, it } from "vitest";

import {
  ABAS_DA_BARRA_INFERIOR,
  abaAtiva,
  abasDaBarraInferior,
  barraInferiorVisivel,
} from "@/lib/navigation/barra-inferior";
import { canSee, NAV_DESTINATIONS } from "@/lib/navigation/registry";
import { ROLE_RANK, type Role } from "@/lib/auth/types";

const ROLES = Object.keys(ROLE_RANK) as Role[];

/**
 * A barra de abas do celular (04/11/2026, "navegação no celular ruim demais").
 * Os casos que importam são os que falham calados: uma aba apontando para tela
 * que não existe mais, uma aba que mostra porta a quem não pode entrar, e a
 * barra por cima do campo de escrever de uma conversa aberta.
 */
describe("barra de abas do celular", () => {
  it("toda aba é uma tela do registro — nenhuma porta fora de NAV_DESTINATIONS", () => {
    for (const href of ABAS_DA_BARRA_INFERIOR) {
      expect(
        NAV_DESTINATIONS.some((d) => d.href === href),
        `${href} não está no registro de navegação`,
      ).toBe(true);
    }
  });

  it("cada papel vê só as abas que o registro deixa ver", () => {
    for (const role of ROLES) {
      const hrefs = abasDaBarraInferior(false, role).map((a) => a.href);
      const esperado = ABAS_DA_BARRA_INFERIOR.filter((href) => {
        const d = NAV_DESTINATIONS.find((x) => x.href === href)!;
        return canSee(d, false, role);
      });
      expect(hrefs, role).toEqual(esperado);
    }
  });

  it("o atendente (agent) tem Conversas como primeira aba", () => {
    const abas = abasDaBarraInferior(false, "agent");
    expect(abas[0]).toMatchObject({ href: "/app/inbox", rotulo: "Conversas" });
  });

  it("sem organização ativa, nenhuma aba (e o 'Mais' segue sendo a saída)", () => {
    expect(abasDaBarraInferior(false, null)).toEqual([]);
  });

  it("some com a conversa aberta — o rodapé é do campo de escrever", () => {
    expect(barraInferiorVisivel("/app/inbox", null)).toBe(true);
    expect(barraInferiorVisivel("/app/inbox", "conv-1")).toBe(false);
    expect(barraInferiorVisivel("/app/inbox/conv-1", null)).toBe(false);
  });

  it("fica em todas as outras telas, mesmo com um ?id= que não é de conversa", () => {
    expect(barraInferiorVisivel("/app/kanban", null)).toBe(true);
    expect(barraInferiorVisivel("/app/contacts", "qualquer")).toBe(true);
  });

  it("acende a aba da tela e das telas dentro dela, sem casar por prefixo de texto", () => {
    expect(abaAtiva("/app/contacts", "/app/contacts")).toBe(true);
    expect(abaAtiva("/app/contacts/abc", "/app/contacts")).toBe(true);
    expect(abaAtiva("/app/contactsx", "/app/contacts")).toBe(false);
    expect(abaAtiva("/app/kanban", "/app/inbox")).toBe(false);
  });
});
