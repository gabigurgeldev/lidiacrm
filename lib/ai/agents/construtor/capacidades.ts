/**
 * Pacotes de capacidade que cabem num agente — regra pura, client-safe.
 *
 * O teto de ferramentas por agente (`TETO_TOOLS_POR_AGENTE`) é real, e os
 * pacotes são grandes: medido, quase nenhum PAR de pacotes cabe junto
 * (atender+vender passa do teto). O modelo sugere pacotes em ordem de
 * importância; esta função liga na ordem enquanto couber e devolve o que
 * ficou de fora, em vez de deixar o `versionShapeSchema` recusar a versão
 * inteira na hora de criar.
 *
 * Recebe o MAPA pacote → ferramentas em vez de ler o catálogo: o catálogo com
 * handler é server-side, e a tela precisa da mesma conta para mostrar quantas
 * ferramentas cabem enquanto a pessoa liga e desliga.
 */
import type { ToolBundle } from "@/lib/mcp/tools/pacotes";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";

export type MapaDePacotes = Readonly<Record<ToolBundle, readonly string[]>>;

export function ferramentasDe(pacotes: readonly ToolBundle[], mapa: MapaDePacotes): Set<string> {
  const todas = new Set<string>();
  for (const p of pacotes) for (const f of mapa[p] ?? []) todas.add(f);
  return todas;
}

export function pacotesQueCabem(
  pedidos: readonly ToolBundle[],
  mapa: MapaDePacotes,
  teto: number = TETO_TOOLS_POR_AGENTE,
): { cabem: ToolBundle[]; foraDoTeto: ToolBundle[] } {
  const cabem: ToolBundle[] = [];
  const foraDoTeto: ToolBundle[] = [];
  for (const p of new Set(pedidos)) {
    if (ferramentasDe([...cabem, p], mapa).size <= teto) cabem.push(p);
    else foraDoTeto.push(p);
  }
  return { cabem, foraDoTeto };
}
