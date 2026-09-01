import type { ZodSchema } from "zod";

import { ApiError, type ApiErrorBody } from "@/lib/api/types";
import { randomId } from "@/lib/random-id";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestOpts = {
  schema?: ZodSchema<unknown>;
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * Desliga a repetição automática desta chamada. Uma tentativa, e ponto.
   *
   * ⚠️ EXISTE PARA CHAMADA CARA E LONGA, e o caso que a criou é concreto: a
   * montagem de um fluxo com IA faz N chamadas ao provedor e pode levar ~25s.
   * Se ela estourar o teto de tempo, o laço abaixo tenta MAIS DUAS VEZES — nove
   * minutos de espera e três vezes o custo no provedor, para chegar ao mesmo
   * lugar, com a pessoa olhando uma tela parada.
   *
   * É o mesmo argumento que a lista `RETRYABLE_SE_NAO_FOR_ERRO_NOSSO` já faz
   * para o 502 das rotas de IA ("repetir é o pior a fazer"), aplicado ao
   * timeout, que aquela lista não alcança porque nem chega a haver resposta.
   *
   * Não é o padrão: repetir é certo para a chamada curta e barata, que é a
   * esmagadora maioria.
   */
  semRepetir?: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Sempre retentáveis: o servidor pediu espera, e o corpo é irrelevante. */
const RETRYABLE_STATUSES = new Set([429, 503]);

/**
 * 502 e 504 são retentáveis SOMENTE quando o corpo não é um erro da nossa API.
 *
 * A distinção não é preciosismo — ela separa dois eventos opostos que dividem o
 * mesmo número. Quando quem responde é o proxy (durante a troca de contêiner de
 * um deploy, por exemplo), o corpo é uma página e tentar de novo resolve, porque
 * a indisponibilidade dura menos que o backoff. Mas nossas rotas de IA usam 502
 * para dizer "o provedor recusou", e ali repetir é o pior a fazer: três
 * chamadas ao modelo, três vezes o custo e a espera, para chegar à mesma recusa.
 *
 * O primeiro desenho desta lista tratava 502 como sempre retentável e teria
 * feito exatamente isso com `flows/[id]/ai/interpretar`.
 */
const RETRYABLE_SE_NAO_FOR_ERRO_NOSSO = new Set([502, 504]);

/** Acima disso, um corpo de erro é despejo de página, não frase para alguém ler. */
const MAX_MENSAGEM_DE_CORPO = 200;
const MUTATING_METHODS = new Set<HttpMethod>(["POST", "PATCH", "PUT", "DELETE"]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffMs(attempt: number): number {
  const base = 200 * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 100 - 50;
  return Math.max(0, Math.round(base + jitter));
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

/**
 * A frase que vai para a tela quando o corpo do erro NÃO veio da nossa API.
 *
 * Existe porque o corpo cru era usado como mensagem, e num restart de deploy o
 * corpo é a página de erro do proxy: a tela do construtor de fluxo exibiu um
 * `<!DOCTYPE html>` inteiro, com SVG e links, no lugar de uma frase. Quem viu
 * aquilo não tinha como saber que bastava tentar de novo — e era só isso.
 */
function mensagemPorStatus(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "O servidor está indisponível no momento (pode ser uma atualização em andamento). Tente de novo em alguns segundos.";
  }
  if (status >= 500) return "O servidor falhou ao processar o pedido.";
  if (status === 404) return "Endereço não encontrado no servidor.";
  if (status === 401 || status === 403) return "Sem permissão para esta ação.";
  return `A requisição falhou (HTTP ${status}).`;
}

/**
 * Só usa o corpo como mensagem quando ele é PLAUSÍVEL como frase.
 *
 * Duas recusas, e as duas foram vistas em produção: página HTML (o `<` inicial
 * denuncia proxy, gateway ou CDN respondendo no lugar do app) e texto longo
 * demais para caber numa linha de tela. O corpo não se perde — ele continua
 * disponível no console via `details`; o que ele deixa de fazer é virar
 * interface.
 */
function mensagemDeCorpo(corpo: unknown, status: number): string {
  if (typeof corpo !== "string") return mensagemPorStatus(status);
  const texto = corpo.trim();
  if (texto.length === 0) return mensagemPorStatus(status);
  if (texto.startsWith("<")) return mensagemPorStatus(status);
  if (texto.length > MAX_MENSAGEM_DE_CORPO) return mensagemPorStatus(status);
  return texto;
}

function synthesizeCode(status: number): string {
  if (status === 502 || status === 503 || status === 504) return "service_unavailable";
  if (status >= 500) return "internal_error";
  if (status === 429) return "rate_limited";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status >= 400) return "unknown_error";
  return "unknown_error";
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    sig.addEventListener(
      "abort",
      () => controller.abort(sig.reason),
      { once: true },
    );
  }
  return controller.signal;
}

async function readBodySafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  opts: RequestOpts = {},
): Promise<T> {
  const requestId = randomId();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-Id": requestId,
    ...(opts.headers ?? {}),
  };

  if (body !== undefined && body !== null) {
    headers["Content-Type"] ??= "application/json";
  }

  if (MUTATING_METHODS.has(method)) {
    headers["Idempotency-Key"] ??= opts.idempotencyKey ?? randomId();
  }

  const serializedBody =
    body === undefined || body === null ? undefined : JSON.stringify(body);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  const tentativas = opts.semRepetir === true ? 1 : MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= tentativas; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = combineSignals([timeoutController.signal, opts.signal]);

    try {
      const res = await fetch(path, {
        method,
        headers,
        body: serializedBody,
        credentials: "same-origin",
        signal,
      });

      const responseRequestId = res.headers.get("X-Request-Id") ?? requestId;

      if (res.ok) {
        const parsed = (await readBodySafe(res)) as T;
        if (opts.schema) {
          return opts.schema.parse(parsed) as T;
        }
        return parsed;
      }

      // O corpo é lido ANTES da decisão de retry porque, em 502/504, é ele que
      // diz de quem veio a resposta — e portanto se repetir faz sentido.
      const errBody = await readBodySafe(res);
      const ehErroNosso = isApiErrorBody(errBody);

      const podeRepetir =
        RETRYABLE_STATUSES.has(res.status) ||
        (RETRYABLE_SE_NAO_FOR_ERRO_NOSSO.has(res.status) && !ehErroNosso);

      if (podeRepetir && attempt < tentativas) {
        const retryAfter = parseRetryAfterSeconds(res.headers.get("Retry-After"));
        const delay = retryAfter !== null ? retryAfter * 1000 : backoffMs(attempt);
        await sleep(delay, opts.signal);
        continue;
      }
      if (ehErroNosso && isApiErrorBody(errBody)) {
        const e = errBody.error;
        throw new ApiError(
          res.status,
          e.code ?? synthesizeCode(res.status),
          e.details,
          e.request_id ?? responseRequestId,
          e.message,
        );
      }
      throw new ApiError(
        res.status,
        synthesizeCode(res.status),
        // O corpo cru vai para `details`, não para `message`: quem depura ainda
        // o alcança, e a tela para de renderizá-lo.
        typeof errBody === "string" && errBody.length > 0
          ? { corpo_bruto: errBody.slice(0, 2000) }
          : undefined,
        responseRequestId,
        mensagemDeCorpo(errBody, res.status),
      );
    } catch (err) {
      // ApiError thrown above for non-retryable: propagate immediately
      if (err instanceof ApiError) {
        throw err;
      }
      // Caller-provided signal aborted: propagate without retry
      if (opts.signal?.aborted) {
        throw err;
      }
      // Network error / timeout — retry
      lastError = err;
      if (attempt < tentativas) {
        await sleep(backoffMs(attempt), opts.signal);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Exhausted retries on retryable status: throw a synthetic ApiError
  throw lastError ??
    new ApiError(
      503,
      "service_unavailable",
      undefined,
      requestId,
      "Max retries exhausted",
    );
}

export const apiClient = {
  get<T>(path: string, opts?: RequestOpts): Promise<T> {
    return request<T>("GET", path, undefined, opts);
  },
  post<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>("POST", path, body, opts);
  },
  patch<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>("PATCH", path, body, opts);
  },
  put<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>("PUT", path, body, opts);
  },
  /**
   * `body` é OPCIONAL e novo: a rota de cancelar agendamento exige `{id, reason}`
   * no corpo do DELETE — o motivo do cancelamento é obrigatório de propósito
   * ("cancelado" sem motivo faz alguém ligar para o cliente perguntando o que
   * houve, ou pior, não ligar). Parâmetro opcional no fim mantém os chamadores
   * antigos byte a byte.
   */
  delete<T>(path: string, body?: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>("DELETE", path, body, opts);
  },
};
