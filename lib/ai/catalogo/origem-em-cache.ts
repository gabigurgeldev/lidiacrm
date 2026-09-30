/**
 * O catálogo da OpenRouter guardado em memória por alguns minutos — só para a
 * busca que a pessoa faz digitando no seletor de modelo.
 *
 * A origem devolve ~400 modelos num JSON de centenas de KB. A busca dispara a
 * cada pausa na digitação; ir à origem a cada tecla seria lento para quem
 * digita e grosseiro com quem publica o catálogo de graça. Cinco minutos é
 * curto o bastante para modelo lançado agora aparecer logo — e quem cola o
 * código exato de um modelo que o cache ainda não conhece não fica na mão:
 * `fresco: true` ignora a memória (ver a rota que adiciona o modelo).
 *
 * O cron diário e o botão "Sincronizar" NÃO passam por aqui: eles conciliam o
 * catálogo inteiro e precisam da resposta do momento, sem memória nenhuma.
 *
 * Falha nunca é guardada — senão um soluço de rede de um segundo deixaria a
 * busca quebrada pelos cinco minutos seguintes.
 */
import type { ModeloDaOpenRouter } from "./openrouter";

export const VALIDADE_DO_CACHE_MS = 5 * 60_000;

type Buscar = () => Promise<ModeloDaOpenRouter[]>;

let guardado: { em: number; modelos: ModeloDaOpenRouter[] } | null = null;
let emVoo: Promise<ModeloDaOpenRouter[]> | null = null;

export async function catalogoDaOrigem(
  buscar: Buscar,
  opts: { fresco?: boolean; agora?: () => number } = {},
): Promise<ModeloDaOpenRouter[]> {
  const agora = opts.agora ?? Date.now;
  if (!opts.fresco && guardado && agora() - guardado.em < VALIDADE_DO_CACHE_MS) {
    return guardado.modelos;
  }
  // Duas buscas simultâneas (duas abas, duas pessoas) viram uma ida à origem.
  if (!emVoo) {
    emVoo = buscar()
      .then((modelos) => {
        guardado = { em: agora(), modelos };
        return modelos;
      })
      .finally(() => {
        emVoo = null;
      });
  }
  return emVoo;
}

/** Só para teste: começa cada caso sem memória herdada do anterior. */
export function esquecerCatalogoDaOrigem(): void {
  guardado = null;
  emVoo = null;
}
