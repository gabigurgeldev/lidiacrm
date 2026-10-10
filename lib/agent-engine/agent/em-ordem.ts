/**
 * Faz as chamadas de uma função assíncrona rodarem UMA de cada vez, na ordem
 * em que foram feitas.
 *
 * ## Por que existe
 *
 * O modelo pode pedir duas ferramentas no MESMO passo, e o SDK executa as duas
 * em paralelo. Para `send_message` isso embaralhava a conversa: cada envio
 * disputa a trava anti-ban do número, e quem a pega primeiro sai primeiro —
 * não quem o modelo escreveu primeiro. Medido em produção (Açaí Delícia,
 * 2026-10-09): o modelo pediu "1 litro anotado" e "Quer algum adicional?", e o
 * cliente recebeu a pergunta ANTES da confirmação. A resposta dele à pergunta
 * chegava fora de contexto, e a pergunta voltava no turno seguinte.
 *
 * As execuções começam na ordem dos pedidos (o SDK as dispara em sequência,
 * só não espera uma terminar antes da outra), então encadear numa fila basta
 * para que a ordem de entrega seja a ordem escrita.
 *
 * Uma chamada que falha não trava as seguintes: o erro volta a quem chamou, e
 * a fila segue.
 */
export function emOrdem<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  fila: FilaDeEnvio = novaFilaDeEnvio(),
): (...args: A) => Promise<R> {
  return (...args: A): Promise<R> => {
    const resultado = fila.ultima.then(() => fn(...args));
    fila.ultima = resultado.catch(() => undefined);
    return resultado;
  };
}

/**
 * Uma fila que DUAS ferramentas podem dividir.
 *
 * Existe porque a ordem do turno não é só entre mensagens de texto: o modelo
 * pode pedir "Perfeito, anotado!" (send_message) e a enquete do próximo passo
 * (send_options) no mesmo passo. Com uma fila por ferramenta, as duas correm
 * entre si e a enquete pode chegar ANTES da confirmação — o mesmo defeito do
 * cabeçalho, entre ferramentas diferentes.
 */
export interface FilaDeEnvio {
  ultima: Promise<unknown>;
}

export function novaFilaDeEnvio(): FilaDeEnvio {
  return { ultima: Promise.resolve() };
}
