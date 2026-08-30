/**
 * GET /api/v1/flows/nodes — a paleta, PROJETADA do registry.
 *
 * A tela não tem lista própria de blocos. É esta rota que responde "o que dá
 * para arrastar", e ela lê o mesmo registry que o motor executa — então bloco
 * novo aparece na paleta no mesmo commit em que passa a existir, e bloco que
 * some da paleta é bloco que o motor também não conhece mais.
 *
 * Uma lista digitada no frontend divergiria na primeira adição, e a divergência
 * seria da pior espécie: um bloco desenhável que o motor recusa na publicação.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { todosOsNos } from "@/lib/flow-engine/registry";
import { CATEGORIAS_DE_NO } from "@/lib/flow-engine/types";

export const dynamic = "force-dynamic";

/** Rótulo de cada categoria na paleta. Em português de operação, não de API. */
const NOME_DA_CATEGORIA: Record<string, string> = {
  trigger: "Começo",
  logic: "Decisão e tempo",
  crm: "Funil",
  whatsapp: "WhatsApp",
  routing: "Distribuição",
  notify: "Avisos",
};

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;

  garantirNosRegistrados();

  const nos = todosOsNos().map((n) => ({
    type: n.type,
    version: n.version,
    category: n.category,
    rotulo: n.rotulo,
    descricao: n.descricao,
    eventos: n.eventos ?? null,
  }));

  const categorias = CATEGORIAS_DE_NO.filter((c) => nos.some((n) => n.category === c)).map((c) => ({
    id: c,
    rotulo: NOME_DA_CATEGORIA[c] ?? c,
  }));

  return ok({ categorias, nos }, { requestId });
}
