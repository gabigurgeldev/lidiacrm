import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONHECIMENTO } from "@/agente/conhecimento.gerado";
import { conferir, montarConhecimento, type PaginaDoManual } from "@/agente/conhecimento/montar";
import { NAV_DESTINATIONS, NAV_GROUPS } from "@/lib/navigation/registry";

/**
 * A assistente sabe o que o sistema TEM HOJE.
 *
 * O build regenera `agente/conhecimento.gerado.ts` (`prebuild`), mas o arquivo
 * também é commitado — e é ele que o typecheck e os testes leem. Este teste
 * reprova quando:
 *  - uma tela entra no menu (`lib/navigation/registry.ts`) sem página no manual
 *    (`agente/conhecimento/*.md`, linha `Rotas:`);
 *  - uma página cita rota que saiu do menu;
 *  - o gerado commitado não bate com o que o gerador produziria agora.
 *
 * Conserto, nos três casos: edite o `.md` e rode
 * `pnpm exec tsx scripts/agente/gerar-conhecimento.ts`.
 */

const PASTA = join(process.cwd(), "agente", "conhecimento");
const paginas: PaginaDoManual[] = readdirSync(PASTA)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((arquivo) => ({ arquivo, conteudo: readFileSync(join(PASTA, arquivo), "utf8") }));

describe("conhecimento da assistente", () => {
  it("toda tela do menu tem página no manual, e nenhuma página cita rota morta", () => {
    expect(conferir(NAV_GROUPS, NAV_DESTINATIONS, paginas)).toEqual({
      rotasSemPagina: [],
      rotasInexistentes: [],
      paginasSemRotas: [],
    });
  });

  it("o gerado commitado está em dia com os .md e o menu", () => {
    expect(CONHECIMENTO).toBe(montarConhecimento(NAV_GROUPS, NAV_DESTINATIONS, paginas));
  });

  it("o manual não vaza arquitetura interna nem a marca de fábrica", () => {
    for (const p of paginas) {
      expect(p.conteudo, p.arquivo).not.toMatch(
        /supabase|postgres|organization_id|service[_ ]role|api\/v1|migration|\.env|AGENTE_|lidia|deskcomm|gestalt/i,
      );
    }
  });
});
