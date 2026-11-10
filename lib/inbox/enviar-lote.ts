/**
 * Várias fotos de uma vez pelo composer do inbox — a parte que decide ORDEM,
 * RITMO e o que sobra quando um item falha.
 *
 * Mora fora do componente porque é a parte que erra em silêncio:
 *
 * - **Ordem.** Os envios saem um depois do outro, cada um esperando o anterior
 *   voltar. Em paralelo, as mensagens ganhariam `sent_at` quase iguais e o fio
 *   (ordenado por `sent_at, id`, com id aleatório) poderia mostrar as fotos
 *   embaralhadas — logo no caso de uso, que é "opção 1, opção 2, opção 3".
 * - **Ritmo.** O envio manual do inbox não passa pelo `decidePacing` do motor
 *   (`app/api/v1/messages/_handler.ts` despacha direto). Uma foto por clique
 *   nunca precisou; dez de uma vez são uma rajada, e rajada é o que o WhatsApp
 *   lê como robô. O espaçamento usa os MESMOS números do motor anti-ban
 *   (`PACING_DEFAULTS`), nunca um literal daqui.
 * - **Falha no meio.** Para no primeiro erro e devolve quantos saíram: quem
 *   chama mantém na tela só os que faltam, e "tentar de novo" não reenvia o que
 *   o cliente já recebeu. Mensagem dobrada não se desfaz.
 */
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";

/**
 * Teto de arquivos por lote. Dez cobre "várias opções para o cliente" com
 * folga e mantém o lote inteiro em ~20 s no ritmo anti-ban; mais que isso é
 * catálogo, e catálogo tem caminho próprio (disparo).
 */
export const LIMITE_DO_LOTE = 10;

/** Junta os arquivos novos aos que já estão no preview, respeitando o teto. */
export function juntarAoLote(
  atuais: readonly File[],
  novos: readonly File[],
  limite: number = LIMITE_DO_LOTE,
): { arquivos: File[]; descartados: number } {
  const vagas = Math.max(limite - atuais.length, 0);
  return {
    arquivos: [...atuais, ...novos.slice(0, vagas)],
    descartados: Math.max(novos.length - vagas, 0),
  };
}

/** Intervalo entre dois envios do lote: o piso do motor + um jitter sorteado. */
export function intervaloEntreEnvios(sortear: () => number = Math.random): number {
  return PACING_DEFAULTS.throttleMs + Math.floor(sortear() * PACING_DEFAULTS.jitterMaxMs);
}

export interface OpcoesDoLote {
  /** Injetável para o teste não dormir de verdade. */
  esperar?: (ms: number) => Promise<void>;
  sortear?: () => number;
  /** `feitos` já enviados de `total` — para a tela dizer "Enviando 3 de 8". */
  onProgresso?: (feitos: number, total: number) => void;
}

export interface ResultadoDoLote {
  /** Quantos saíram, a contar do primeiro. Os de índice ≥ `enviados` não saíram. */
  enviados: number;
  /** O erro que parou o lote; ausente quando todos saíram. */
  erro?: unknown;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envia `itens` em sequência, espaçados, parando no primeiro erro.
 * Nunca lança: o erro volta em `ResultadoDoLote.erro` (o toast já é do hook).
 */
export async function enviarEmLote<T>(
  itens: readonly T[],
  enviar: (item: T, indice: number) => Promise<unknown>,
  opcoes: OpcoesDoLote = {},
): Promise<ResultadoDoLote> {
  const esperar = opcoes.esperar ?? dormir;
  const total = itens.length;
  for (let i = 0; i < total; i++) {
    if (i > 0) await esperar(intervaloEntreEnvios(opcoes.sortear));
    opcoes.onProgresso?.(i, total);
    try {
      await enviar(itens[i]!, i);
    } catch (erro) {
      return { enviados: i, erro };
    }
  }
  opcoes.onProgresso?.(total, total);
  return { enviados: total };
}
