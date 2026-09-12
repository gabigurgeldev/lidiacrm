/**
 * O MOTIVO DA RECUSA, NA TRILHA — porque hoje ele não chega a lugar nenhum.
 *
 * ─── O que aconteceu, três vezes ────────────────────────────────────────────
 *
 * O bloco de envio ao cliente NÃO mata a execução quando a mensagem não sai:
 * ele segue pela saída "Não saiu agora" e grava o motivo em `vars`
 * (`envio_recusado`). Isso está certo — o resto do fluxo costuma continuar
 * fazendo sentido.
 *
 * Só que o motivo morria ali. O passo gravado em `flow_execution_events` levava
 * `{ ramo, proximo }` e mais nada, e a tela de execuções desenha só o nome do
 * passo e o id do bloco. O `vars` ia para `flow_executions.context`, que
 * nenhuma tela lê.
 *
 * Resultado, medido com o dono do produto: o envio falhava, a execução aparecia
 * como concluída, e não havia UMA LINHA em lugar nenhum dizendo por quê. Ele
 * reportou "não funcionou" três vezes sem ter o que anexar — e eu consertei três
 * causas plausíveis diferentes sem nunca ver o erro real. A falha invisível não
 * custou só o defeito: custou as três rodadas de adivinhação.
 *
 * ─── Por que uma LISTA, e não `vars` inteiro ────────────────────────────────
 *
 * Porque `flow_execution_events.payload` **não é limpo pela cascata de
 * anonimização da LGPD**. A migration 0208 alcança `flow_executions`
 * (`input`, `output`, `context`, `lineage`, `last_error`) e
 * `flow_execution_frames.vars` — e para nos passos. Despejar `vars` ali criaria
 * um lugar novo onde a frase de uma pessoa (`menu_resposta` é o texto que o
 * cliente escreveu) sobrevive ao pedido de exclusão dela.
 *
 * Então entra só o que é DIAGNÓSTICO NOSSO: códigos de erro e motivos que o
 * próprio sistema escreveu. Nenhuma chave desta lista carrega conteúdo do
 * cliente, e é por isso que ela é uma lista e não um filtro esperto.
 */

/**
 * As chaves de `vars` que descrevem por que algo não saiu.
 *
 * ⚠️ NÃO acrescente aqui chave que carregue texto do cliente (`menu_resposta`) ou
 * dado pessoal. Ver o cabeçalho: este payload sobrevive à anonimização.
 */
export const CHAVES_DE_DIAGNOSTICO = [
  "envio_recusado",
  "envio_na_fila",
  "aviso_recusado_por",
  "aviso_na_fila_por",
  "disparo_recusado",
  "ia_erro",
] as const;

/** As frases que a tela mostra. Em português de operação, não de código. */
export const ROTULO_DO_DIAGNOSTICO: Record<string, string> = {
  envio_recusado: "A mensagem não saiu",
  envio_na_fila: "A mensagem ficou na fila do canal",
  aviso_recusado_por: "O aviso ao vendedor não saiu",
  aviso_na_fila_por: "O aviso ficou na fila do canal",
  disparo_recusado: "A campanha não foi criada",
  ia_erro: "A entrega ao agente falhou",
};

export interface DiagnosticoDoPasso {
  chave: string;
  /** O rótulo legível, quando conhecido; a chave crua quando não. */
  rotulo: string;
  /** O motivo cru, como o canal ou a porta o devolveu. */
  motivo: string;
}

/** O que, de `vars`, merece ir para o passo — e para a tela. */
export function diagnosticoDasVars(
  vars: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!vars) return {};
  const out: Record<string, string> = {};
  for (const chave of CHAVES_DE_DIAGNOSTICO) {
    const valor = vars[chave];
    if (typeof valor === "string" && valor.trim() !== "") out[chave] = valor;
    // Booleano e número entram como texto: `envio_na_fila` pode vir de uma porta
    // que devolve outra forma, e perder o sinal por causa do tipo seria repetir
    // o defeito que este arquivo existe para fechar.
    else if (typeof valor === "number" || typeof valor === "boolean") out[chave] = String(valor);
  }
  return out;
}

/** O mesmo, já pronto para a tela desenhar. */
export function diagnosticosDoPayload(payload: unknown): DiagnosticoDoPasso[] {
  if (typeof payload !== "object" || payload === null) return [];
  const p = payload as Record<string, unknown>;
  return CHAVES_DE_DIAGNOSTICO.filter((c) => typeof p[c] === "string" && p[c] !== "").map((c) => ({
    chave: c,
    rotulo: ROTULO_DO_DIAGNOSTICO[c] ?? c,
    motivo: String(p[c]),
  }));
}
