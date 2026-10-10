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
export function emOrdem<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let fila: Promise<unknown> = Promise.resolve();
  return (...args: A): Promise<R> => {
    const resultado = fila.then(() => fn(...args));
    fila = resultado.catch(() => undefined);
    return resultado;
  };
}
