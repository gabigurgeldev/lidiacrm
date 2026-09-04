/**
 * Flow Engine — por que a entrada da IA foi recusada, dito de um jeito útil.
 *
 * ═══ O defeito que este arquivo existe para não repetir ═══
 *
 * As três rotas de IA de fluxo recusavam qualquer entrada malformada com a
 * MESMA frase: "Descreva o que você quer antes de continuar." Ela está certa
 * para campo vazio e é uma mentira para texto grande demais — e o campo tem
 * teto de 2000 caracteres que a tela nunca anunciou.
 *
 * Medido: um pedido de 3153 caracteres, colado por quem estava testando o
 * produto, recebeu de volta "descreva o que você quer" **com o texto na tela**.
 * A pessoa leu aquilo como "a IA não entendeu o meu pedido" e reescreveu o
 * pedido três vezes — que é o conserto que a mensagem pedia, e não o que o
 * problema exigia.
 *
 * Uma mensagem de erro que descreve a causa errada não é um detalhe de texto:
 * ela manda a pessoa consertar a coisa errada.
 */
import type { z } from "zod";

/** O teto de caracteres do campo de pedido, compartilhado pelas três rotas. */
export const MAX_CARACTERES_DO_PEDIDO = 2000;

/**
 * A frase para uma entrada recusada — a causa de verdade, quando dá para saber.
 *
 * `corpo` é o JSON cru: o Zod diz que `pedido` é grande demais, mas só o corpo
 * diz QUANTO — e o número é o que transforma "encurte" em uma instrução que a
 * pessoa consegue seguir.
 */
export function motivoDaEntradaRecusada(erro: z.ZodError, corpo: unknown): string {
  const pedido = (corpo as { pedido?: unknown } | null)?.pedido;
  const grandeDemais = erro.issues.some(
    (i) => i.code === "too_big" && i.path[0] === "pedido",
  );
  if (grandeDemais && typeof pedido === "string") {
    return (
      `O pedido tem ${pedido.trim().length} caracteres e o limite é ` +
      `${MAX_CARACTERES_DO_PEDIDO}. Encurte, ou peça o resto numa segunda ` +
      `mensagem depois que o fluxo estiver montado.`
    );
  }
  const historicoLongo = erro.issues.some((i) => i.code === "too_big" && i.path[0] === "historico");
  if (historicoLongo) {
    return "A conversa ficou longa demais. Feche o painel e comece um pedido novo.";
  }
  return "Descreva o que você quer antes de continuar.";
}
