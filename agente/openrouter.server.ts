/**
 * A chamada ao modelo da assistente de suporte — `fetch` direto no OpenRouter.
 *
 * NÃO passa por `resolveLanguageModel` (`lib/ai/gateway.ts`) nem pelas
 * credenciais por organização (`ai_provider_credentials`) nem pela
 * `OPENROUTER_API_KEY`: aquelas pagam o agente que atende o CLIENTE da empresa,
 * e são escolha de cada organização. A ajuda de uso é custo da instalação, com
 * chave própria (`AGENTE_OPENROUTER_API_KEY`). Misturar faria uma organização
 * pagar a ajuda dos outros — ou a assistente parar porque o tenant trocou de
 * provedor.
 *
 * Formato OpenAI (`/chat/completions`, `tools`), que o OpenRouter fala para
 * qualquer modelo. Sem streaming na v1: o widget mostra "digitando…".
 */
import "./so-no-servidor";

const URL_DO_OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export interface ChamadaDeFerramenta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Bloco de texto do system com `cache_control` — o OpenRouter repassa à Anthropic. */
export interface BlocoDeTexto {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export type MensagemDoModelo =
  | { role: "system"; content: string | BlocoDeTexto[] }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChamadaDeFerramenta[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface PedidoAoModelo {
  model: string;
  messages: MensagemDoModelo[];
  tools?: unknown[];
  tool_choice?: "auto" | "none";
  max_tokens: number;
}

export interface RespostaDoModelo {
  texto: string | null;
  chamadas: ChamadaDeFerramenta[];
  tokensIn: number;
  tokensOut: number;
  /** USD, quando o OpenRouter informa (`usage.include`). */
  custoUsd: number | null;
}

export type ChamarModelo = (
  pedido: PedidoAoModelo,
  sinal: AbortSignal,
) => Promise<RespostaDoModelo>;

export class ModeloIndisponivel extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ModeloIndisponivel";
  }
}

const esperar = (ms: number, sinal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    sinal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(sinal.reason ?? new Error("abortado"));
      },
      { once: true },
    );
  });

/**
 * O corpo enviado ao OpenRouter. `provider.data_collection: "deny"` restringe o
 * roteamento a provedores que NÃO guardam nem treinam com o pedido — a
 * conversa leva nome de cliente da empresa, e quem decide para onde vai esse
 * dado é o controlador, não o provedor mais barato da vez.
 */
export function corpoDoPedido(pedido: PedidoAoModelo) {
  return { ...pedido, usage: { include: true }, provider: { data_collection: "deny" as const } };
}

export function chamarOpenRouter(apiKey: string): ChamarModelo {
  return async (pedido, sinal) => {
    // Uma nova tentativa em 429/5xx — o limite de 25s do laço é quem manda.
    for (let tentativa = 0; ; tentativa++) {
      const resp = await fetch(URL_DO_OPENROUTER, {
        method: "POST",
        signal: sinal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpoDoPedido(pedido)),
      });

      if ((resp.status === 429 || resp.status >= 500) && tentativa === 0) {
        await esperar(800, sinal);
        continue;
      }
      if (!resp.ok) {
        // O corpo NÃO vai para a mensagem: pode ecoar parte do pedido.
        throw new ModeloIndisponivel(`OpenRouter respondeu ${resp.status}`, resp.status);
      }

      const corpo = (await resp.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: ChamadaDeFerramenta[] };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      const msg = corpo.choices?.[0]?.message;
      return {
        texto: typeof msg?.content === "string" ? msg.content : null,
        chamadas: Array.isArray(msg?.tool_calls) ? msg.tool_calls : [],
        tokensIn: corpo.usage?.prompt_tokens ?? 0,
        tokensOut: corpo.usage?.completion_tokens ?? 0,
        custoUsd: typeof corpo.usage?.cost === "number" ? corpo.usage.cost : null,
      };
    }
  };
}
