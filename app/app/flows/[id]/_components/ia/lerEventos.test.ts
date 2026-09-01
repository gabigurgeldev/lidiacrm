/**
 * O LEITOR DE SSE PRECISA SOBREVIVER AO CHUNK PARTIDO.
 *
 * A rede não entrega eventos: entrega bytes. Os três casos aqui são os que
 * quebram um leitor escrito na pressa, e nenhum deles aparece em teste manual —
 * localhost entrega chunks grandes e alinhados, e o defeito só nasce em VPS,
 * atrás de proxy, com a conexão de quem está do outro lado do país.
 */
import { describe, expect, it } from "vitest";

import { lerEventos } from "./lerEventos";

function streamDe(pedacos: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controle) {
      for (const p of pedacos) {
        controle.enqueue(typeof p === "string" ? codificador.encode(p) : p);
      }
      controle.close();
    },
  });
}

async function coletar(stream: ReadableStream<Uint8Array>) {
  const saida = [];
  for await (const evento of lerEventos(stream)) saida.push(evento);
  return saida;
}

describe("lerEventos", () => {
  it("lê eventos inteiros", async () => {
    const eventos = await coletar(
      streamDe([
        'data: {"tipo":"bloco","id":"n1","origem":"ia","restantes":2}\n\n',
        'data: {"tipo":"fim","nos":3,"arestas":2,"comExemplo":0}\n\n',
      ]),
    );
    expect(eventos.map((e) => e.tipo)).toEqual(["bloco", "fim"]);
  });

  it("remonta evento partido no meio da linha", async () => {
    const eventos = await coletar(
      streamDe(['data: {"tipo":"bloc', 'o","id":"n1","origem":"ia","restantes":0}', "\n\n"]),
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "bloco", id: "n1" });
  });

  it("remonta caractere UTF-8 partido entre dois chunks", async () => {
    // "ç" são DOIS bytes. Cortar entre eles é o caso que um `decode()` sem
    // `stream: true` transforma em caractere de substituição — e o rótulo do
    // bloco chega com lixo à tela.
    const inteiro = new TextEncoder().encode(
      'data: {"tipo":"erro","codigo":"x","mensagem":"ação"}\n\n',
    );
    const meio = inteiro.indexOf(0xc3); // primeiro byte de "ç"
    const eventos = await coletar(
      streamDe([inteiro.slice(0, meio + 1), inteiro.slice(meio + 1)]),
    );
    expect(eventos[0]).toMatchObject({ tipo: "erro", mensagem: "ação" });
  });

  it("ignora heartbeat sem virar evento", async () => {
    const eventos = await coletar(
      streamDe([":keep-alive\n\n", 'data: {"tipo":"fim","nos":1,"arestas":0,"comExemplo":0}\n\n']),
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe("fim");
  });

  it("ignora evento desconhecido em vez de derrubar a tela", async () => {
    const eventos = await coletar(
      streamDe([
        'data: {"tipo":"coisa_do_futuro","x":1}\n\n',
        "data: nao é json\n\n",
        'data: {"tipo":"fim","nos":1,"arestas":0,"comExemplo":0}\n\n',
      ]),
    );
    expect(eventos.map((e) => e.tipo)).toEqual(["fim"]);
  });

  it("para quando o sinal é abortado", async () => {
    const controle = new AbortController();
    controle.abort();
    const saida = [];
    for await (const evento of lerEventos(
      streamDe(['data: {"tipo":"fim","nos":1,"arestas":0,"comExemplo":0}\n\n']),
      controle.signal,
    )) {
      saida.push(evento);
    }
    expect(saida).toEqual([]);
  });
});
