/**
 * O leitor de SSE da montagem — 60 linhas que substituem o `useObject`.
 *
 * `useObject` era a escolha certa quando a resposta era UM objeto chegando aos
 * pedaços: o hook remontava o objeto parcial e o canvas desenhava o que já
 * existia. Com a geração por etapas o servidor emite EVENTOS discretos (o
 * plano, um bloco pronto, o grafo, o fim), e um parser incremental de objeto
 * único não tem o que fazer com isso.
 *
 * ═══ Os três casos que quebram um leitor ingênuo ═══
 *
 * 1. O chunk não respeita a fronteira do evento: `data: {"ti` chega num pedaço
 *    e `po":"bloco"}\n\n` no seguinte. Por isso o buffer é por `\n\n`, nunca
 *    por chunk.
 * 2. O chunk parte um caractere UTF-8 no meio — e "ação" vira "aÃ§Ã£o" ou pior.
 *    `TextDecoder({ stream: true })` guarda os bytes incompletos para o próximo
 *    pedaço; um `decode()` simples não guarda.
 * 3. Um evento que este cliente não conhece (porque o servidor é mais novo)
 *    derrubaria a tela. Aqui ele é ignorado — cliente velho continua
 *    funcionando, que é a regra num produto que a pessoa atualiza quando quer.
 */
import { eventoDeGeracaoSchema, type EventoDeGeracao } from "@/lib/flow-engine/ai/eventos";

export async function* lerEventos(
  corpo: ReadableStream<Uint8Array>,
  sinal?: AbortSignal,
): AsyncGenerator<EventoDeGeracao> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder("utf-8");
  let buffer = "";

  try {
    for (;;) {
      if (sinal?.aborted) return;
      const { done, value } = await leitor.read();
      if (done) break;

      buffer += decodificador.decode(value, { stream: true });

      let corte = buffer.indexOf("\n\n");
      while (corte !== -1) {
        const bruto = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        corte = buffer.indexOf("\n\n");

        const evento = interpretar(bruto);
        if (evento !== null) yield evento;
      }
    }
  } finally {
    // Sem isto, cancelar deixa a conexão pendurada até o servidor desistir — e
    // o servidor só desiste quando o `req.signal` dele dispara, que é o mesmo
    // cancelamento chegando pelo outro lado.
    try {
      await leitor.cancel();
    } catch {
      /* já fechado */
    }
  }
}

/** `null` para heartbeat, linha vazia, ou evento que este cliente não conhece. */
function interpretar(bruto: string): EventoDeGeracao | null {
  const linhas = bruto.split("\n");
  const dados = linhas
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  if (dados === "") return null; // comentário `:keep-alive` cai aqui

  try {
    const lido = eventoDeGeracaoSchema.safeParse(JSON.parse(dados));
    return lido.success ? lido.data : null;
  } catch {
    return null;
  }
}
