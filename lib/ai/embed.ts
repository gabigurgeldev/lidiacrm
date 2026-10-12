/**
 * Embedding do RAG — indexação e busca, o mesmo MAPA dos dois lados.
 *
 * A chave vem de `lib/ai/embeddings/chave.ts`, que resolve pela organização e
 * devolve JUNTO o modelo da chamada (`chave.modelo`). Este arquivo não escolhe
 * modelo: usa o que veio com a chave. É o que mantém indexação e busca no mesmo
 * mapa — se cada lado decidisse o modelo, bastaria um descuido para o agente
 * parar de achar o material sem erro nenhum.
 *
 * Até a 0181 este arquivo lia SÓ `process.env`, e cadastrar a chave pela tela
 * não habilitava a base de conhecimento. Até 2026-10-12, só falava com
 * endpoints compatíveis com a OpenAI e com um modelo fixo; agora fala também
 * com a Google e com o modelo escolhido no painel (`embeddings/catalogo.ts`).
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import {
  DIMENSOES_DO_EMBEDDING,
  resolverChaveDeEmbedding,
  type ChaveDeEmbedding,
  type PontoDeEmbedding,
} from "@/lib/ai/embeddings/chave";
import { gatewayHeaders } from "@/lib/ai/gateway";

export interface EmbedOptions {
  organizationId: string;
  /**
   * Qual ponto de IA está chamando. Muda de QUAL binding a chave (e o modelo)
   * sai. Os dois pontos são gravados juntos pelo painel, então o mapa é o mesmo.
   */
  ponto?: PontoDeEmbedding;
  /**
   * Chave já resolvida. Existe para o indexador resolver UMA vez e embedar N
   * chunks — e para a busca embedar no mapa de um material antigo
   * (`resolverChaveParaMapa`).
   */
  chave?: ChaveDeEmbedding;
}

export interface EmbedResult {
  embedding: number[];
  promptTokens: number;
  /** O MAPA do vetor — é isto que vai para `ai_knowledge_versions.embedding_model`. */
  model: string;
}

/** Falta de chave é um ESTADO do tenant, não um acidente: tipo próprio para quem
 *  chama poder mostrar a tela certa em vez de repetir um erro genérico. */
export class SemChaveDeEmbeddingError extends Error {
  readonly code = "embedding_sem_chave";
  constructor(readonly organizationId: string) {
    super(
      "Esta organização não tem chave para o modelo que indexa e consulta o material. " +
        "Cadastre uma em Credenciais (OpenAI, OpenRouter ou Google, conforme o modelo escolhido em Provedores), " +
        "ou defina OPENAI_API_KEY ou OPENROUTER_API_KEY na instalação.",
    );
    this.name = "SemChaveDeEmbeddingError";
  }
}

/** Como a Google distingue documento de pergunta — melhora a busca dela. */
type Uso = "indexar" | "consultar";

type OpcoesDoEmbed = Parameters<typeof embed>[0];

function modeloDoSdk(
  chave: ChaveDeEmbedding,
  uso: Uso,
): { model: OpcoesDoEmbed["model"]; providerOptions: OpcoesDoEmbed["providerOptions"] } {
  const { modelo } = chave;
  if (modelo.provedor === "google") {
    return {
      model: createGoogleGenerativeAI({ apiKey: chave.apiKey ?? "" }).textEmbeddingModel(modelo.idNoProvedor),
      providerOptions: modelo.parametro
        ? {
            google: {
              outputDimensionality: DIMENSOES_DO_EMBEDDING,
              taskType: uso === "consultar" ? ("RETRIEVAL_QUERY" as const) : ("RETRIEVAL_DOCUMENT" as const),
            },
          }
        : undefined,
    };
  }
  // OpenAI e OpenRouter falam o mesmo formato; muda o endereço e o jeito de
  // nomear (a OpenRouter quer o fabricante no id — o catálogo já o traz assim).
  //
  // COM gateway: o id do mapa sem o corte é roteado por ele, que lê
  // `AI_GATEWAY_API_KEY` do process.env. SEM gateway, precisa ser o provider
  // explícito: id com barra no AI SDK é resolvido pelo gateway da Vercel mesmo
  // sem chave, no plano anônimo, cujo teto derruba a busca.
  const model = chave.viaGateway
    ? modelo.mapa.replace(/@\d+$/, "")
    : createOpenAI({
        apiKey: chave.apiKey ?? "",
        ...(chave.baseUrl ? { baseURL: chave.baseUrl } : {}),
      }).textEmbeddingModel(modelo.idNoProvedor);
  return {
    model,
    providerOptions: modelo.parametro ? { openai: { dimensions: DIMENSOES_DO_EMBEDDING } } : undefined,
  };
}

export async function embedText(content: string, opts: EmbedOptions): Promise<EmbedResult> {
  const chave = opts.chave ?? (await resolverChaveDeEmbedding(opts.organizationId, opts.ponto));
  if (!chave) {
    throw new SemChaveDeEmbeddingError(opts.organizationId);
  }

  const uso: Uso = opts.ponto === "embedding_consultar" ? "consultar" : "indexar";
  const { model, providerOptions } = modeloDoSdk(chave, uso);
  const result = await embed({
    model,
    value: content,
    ...(providerOptions ? { providerOptions } : {}),
    headers: chave.viaGateway ? gatewayHeaders({ organizationId: opts.organizationId }) : undefined,
  });

  // Dimensão asserida a cada chamada: divergir quebra o recall em SILÊNCIO (os
  // vetores deixam de ser comparáveis), e uma chamada recusada é infinitamente
  // melhor que um acervo que responde errado com nota alta. Também é o que
  // pega um provedor que ignorou o parâmetro de corte.
  if (result.embedding.length !== DIMENSOES_DO_EMBEDDING) {
    throw new Error(
      `embedding com ${result.embedding.length} dimensões, esperado ${DIMENSOES_DO_EMBEDDING} ` +
        `(mapa ${chave.modelo.mapa}) — recall quebraria em silêncio`,
    );
  }

  const promptTokens =
    (result.usage as { tokens?: number; promptTokens?: number } | undefined)?.tokens ??
    (result.usage as { tokens?: number; promptTokens?: number } | undefined)?.promptTokens ??
    0;

  return { embedding: result.embedding, promptTokens, model: chave.modelo.mapa };
}
