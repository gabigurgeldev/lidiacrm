/**
 * Flow Engine — o contrato de fio entre a rota de montagem e o painel.
 *
 * ⚠️ A UNIÃO NA RAIZ AQUI É LEGÍTIMA — e isto precisa estar escrito.
 *
 * `schema-sem-uniao-na-raiz.test.ts` proíbe união no topo de um schema que vai
 * para um PROVEDOR de IA, porque saída estruturada compatível com OpenAI recusa
 * `anyOf` no nível raiz e isso quebrou "Criar fluxo com IA" desde o primeiro
 * dia. Este schema nunca chega perto de um provedor: ele descreve o HTTP entre
 * duas pontas nossas, onde discriminar por `tipo` é exatamente a forma certa.
 * Sem este parágrafo, a próxima sessão "conserta" o que não está quebrado.
 *
 * ═══ SSE, e não NDJSON ou `text/plain` ═══
 *
 * Proxies decidem se bufferizam olhando o content-type e a ausência de
 * `Content-Length`. `text/event-stream` é o caso que Caddy, nginx e CDN tratam
 * explicitamente como "não bufferize" — e o produto é self-host, atrás do proxy
 * de outra pessoa, que ninguém aqui configura.
 *
 * ═══ Por que existe heartbeat ═══
 *
 * É o que permite NÃO mexer no `Caddyfile`. Uma conexão que emite bytes a cada
 * 10s nunca fica ociosa, então nenhum timeout de proxy a corta — e o produto não
 * passa a depender de uma diretiva que o `update.sh` talvez não entregue a quem
 * já instalou.
 */
import { z } from "zod";

import { flowGraphSchema } from "../graph-schema";

export const eventoDeGeracaoSchema = z.discriminatedUnion("tipo", [
  /** O esqueleto: todos os blocos de uma vez, ainda com config de exemplo. */
  z.object({
    tipo: z.literal("plano"),
    blocos: z.array(
      z.object({ id: z.string(), tipo: z.string(), rotulo: z.string(), intencao: z.string() }),
    ),
    ligacoes: z.array(
      z.object({ de: z.string(), para: z.string(), ramo: z.string().optional() }),
    ),
  }),
  /** Um bloco terminou de ser preenchido. `origem` diz se veio do modelo. */
  z.object({
    tipo: z.literal("bloco"),
    id: z.string(),
    origem: z.enum(["ia", "exemplo"]),
    restantes: z.number().int().min(0),
  }),
  /** O grafo montado, determinístico, pronto para o canvas. */
  z.object({ tipo: z.literal("grafo"), grafo: flowGraphSchema }),
  z.object({
    tipo: z.literal("fim"),
    nos: z.number().int(),
    arestas: z.number().int(),
    /** Quantos blocos ficaram com valores padrão — a tela avisa, não esconde. */
    comExemplo: z.number().int(),
  }),
  /** Só para o que acontece DEPOIS dos cabeçalhos; o resto é status HTTP. */
  z.object({ tipo: z.literal("erro"), codigo: z.string(), mensagem: z.string() }),
]);

export type EventoDeGeracao = z.infer<typeof eventoDeGeracaoSchema>;

export function serializarEvento(evento: EventoDeGeracao): string {
  return `data: ${JSON.stringify(evento)}\n\n`;
}

/** Comentário SSE: mantém a conexão viva sem virar evento no cliente. */
export const HEARTBEAT = ":keep-alive\n\n";
export const HEARTBEAT_MS = 10_000;

export const CABECALHOS_SSE: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // `no-transform` importa tanto quanto `no-cache`: sem ele, um proxy que
  // comprime a resposta pode juntar os pedaços e entregar tudo no fim — o
  // stream "funciona" e o progresso ao vivo desaparece.
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx (que parte dos self-hosters põe na frente) só respeita isto.
  "X-Accel-Buffering": "no",
};
