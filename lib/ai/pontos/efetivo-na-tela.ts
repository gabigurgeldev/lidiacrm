/**
 * O que o painel de provedores mostra nos pontos que NÃO passam pela
 * precedência de `decidirBinding` — e por isso não podem exibir o resultado
 * dela.
 *
 * O defeito que este arquivo fecha: a rota GET passava TODO ponto por
 * `decidirBinding`, e quatro deles nunca usam o modelo de conversa. Sem
 * binding, a decisão caía em "padrão da organização" — Claude, por padrão — e
 * a tela anunciava "claude-sonnet-5" em "Buscar no seu material", que é um
 * embedding da OpenAI. Quem lia concluía que a busca rodava no Claude e que não
 * havia como mudar. A transcrição já tinha caso especial; embeddings, ensaio e
 * contagem de tokens não.
 *
 * Puro: a rota junta as chaves e o binding; aqui só se decide o que dizer.
 */
import type { BindingDeTranscricao } from "@/lib/messaging/media/transcription";
import { transcricaoParaATela } from "@/lib/messaging/media/transcription";
import {
  MODELOS_DE_TRANSCRICAO,
  POR_QUE_SO_ESTES,
  PROVEDORES_DE_TRANSCRICAO,
} from "@/lib/messaging/media/modelos-de-transcricao";

export interface EfetivoNaTela {
  provider: string;
  modelId: string | null;
  credentialId: string | null;
  baseUrl: string | null;
  origem: string;
  porQue: string;
}

/** Quando o ponto aceita só alguns provedores/modelos, a tela oferece só estes. */
export interface RestricaoDoPonto {
  provedores: readonly string[];
  modelos: ReadonlyArray<{ provider: string; model_id: string; display_name: string }>;
  explicacao: string;
}

export interface ContextoDaTela {
  /** Há chave (da organização, validada, ou da instalação) para cada provedor. */
  chaves: { openai: boolean; openrouter: boolean };
  bindingDaTranscricao: (BindingDeTranscricao & { credential_id: string | null }) | null;
  /** O modelo de embedding em vigor (hoje, fixo). */
  modeloDeEmbedding: string;
  agentePublicado: { provider: string; model: string } | null;
}

export interface PontoDerivado {
  efetivo: EfetivoNaTela;
  avisos: string[];
  restricao?: RestricaoDoPonto;
}

export const PONTOS_DERIVADOS = new Set([
  "transcricao_de_audio",
  "embedding_indexar",
  "embedding_consultar",
  "teste_de_agente",
  "contagem_de_tokens",
]);

const RESTRICAO_DA_TRANSCRICAO: RestricaoDoPonto = {
  provedores: PROVEDORES_DE_TRANSCRICAO,
  modelos: PROVEDORES_DE_TRANSCRICAO.flatMap((provider) =>
    MODELOS_DE_TRANSCRICAO[provider].map((m) => ({ provider, ...m })),
  ),
  explicacao: POR_QUE_SO_ESTES,
};

/** `null` = ponto comum: a rota usa `decidirBinding`. */
export function efetivoDerivado(pontoId: string, ctx: ContextoDaTela): PontoDerivado | null {
  switch (pontoId) {
    case "transcricao_de_audio": {
      const t = transcricaoParaATela(ctx.chaves, ctx.bindingDaTranscricao);
      return {
        efetivo: {
          provider: t.provider,
          modelId: t.modelId,
          credentialId: ctx.bindingDaTranscricao?.credential_id ?? null,
          baseUrl: ctx.bindingDaTranscricao?.base_url ?? null,
          origem: ctx.bindingDaTranscricao ? "binding" : "escada_de_chave",
          porQue: t.porQue,
        },
        avisos: t.aviso ? [t.aviso] : [],
        restricao: RESTRICAO_DA_TRANSCRICAO,
      };
    }
    case "embedding_indexar":
    case "embedding_consultar": {
      const provider = ctx.chaves.openai ? "openai" : ctx.chaves.openrouter ? "openrouter" : "openai";
      const semChave = !ctx.chaves.openai && !ctx.chaves.openrouter;
      return {
        efetivo: {
          provider,
          modelId: ctx.modeloDeEmbedding,
          credentialId: null,
          baseUrl: null,
          origem: "embedding",
          porQue: semChave
            ? "Embedding (texto → vetor), não modelo de conversa. Falta a chave."
            : `Embedding (texto → vetor), não modelo de conversa. Usando sua chave da ${provider === "openai" ? "OpenAI" : "OpenRouter"}.`,
        },
        avisos: semChave
          ? [
              "Nenhuma chave da OpenAI ou da OpenRouter: o material não é indexado nem consultado, e o agente responde sem conhecer os seus documentos. Cadastre uma delas em Credenciais.",
            ]
          : [],
      };
    }
    case "teste_de_agente":
      return {
        efetivo: {
          provider: ctx.agentePublicado?.provider ?? "—",
          modelId: null,
          credentialId: null,
          baseUrl: null,
          origem: "versao_ensaiada",
          porQue: ctx.agentePublicado
            ? `Usa o modelo da versão que você ensaia (o publicado hoje: ${ctx.agentePublicado.model}).`
            : "Usa o modelo da versão que você ensaia.",
        },
        avisos: [],
      };
    case "contagem_de_tokens":
      return {
        efetivo: {
          provider: "—",
          modelId: null,
          credentialId: null,
          baseUrl: null,
          origem: "modelo_em_uso",
          porQue: "Mede no mesmo provedor do modelo que está respondendo.",
        },
        avisos: [],
      };
    default:
      return null;
  }
}
