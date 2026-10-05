/**
 * A chamada HTTP de uma Integração via API — a única porta de saída.
 *
 * Mesmas guardas do `call_webhook` das automações (`lib/automation/actions/
 * call-webhook.ts`), porque o risco é o mesmo — uma URL escrita por um cliente
 * do CRM, chamada de DENTRO da rede da VPS:
 *
 *   - guarda textual (`assertSafeOutboundUrl`): esquema, https em produção,
 *     host privado, literal IPv6;
 *   - guarda resolvida (`assertDestinoResolvidoSeguro`): o IP de verdade que o
 *     nome resolve (metadata da nuvem, serviços do compose);
 *   - `redirect: "manual"`: um 3xx nunca é seguido — vira `redirect_nao_seguido`;
 *   - timeout por endpoint e corpo lido com teto de 256 KB (um sistema que
 *     devolve 50 MB não derruba o worker).
 *
 * A janela residual de DNS-rebinding entre a resolução e o `fetch` é a mesma
 * declarada em `lib/automation/outbound-ip.ts`.
 *
 * Nada aqui grava no banco: quem chama registra a chamada em `ai_api_chamadas`
 * com o que este módulo devolve (worker com pg, rota com supabase-js).
 */
import { createHmac, randomUUID } from "node:crypto";

import type { AuthTipo, Metodo } from "@/lib/ai/integracoes/schema";
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { cabecalhosAssinados } from "@/lib/suporte/contrato";

export const TETO_DE_BYTES = 256 * 1024;

export type ConfigDeAuth = {
  auth_tipo: AuthTipo;
  auth_header_nome: string | null;
};

export type RespostaDaChamada = {
  ok: boolean;
  http_status: number | null;
  /** JSON já parseado, texto (até 2 KB) quando não é JSON, ou null. */
  dados: unknown;
  erro_codigo: string | null;
  duracao_ms: number;
  bytes_resposta: number;
};

export type OpcoesDaChamada = {
  metodo: Metodo;
  url: string;
  corpo: string | null;
  auth: ConfigDeAuth;
  segredo: string | null;
  timeoutMs: number;
  /** Só no contrato de suporte: o e-mail que o cliente provou com o código. */
  emailVerificado?: string | null;
  /** Ações mandam `Idempotency-Key` = id da ação pendente. */
  idempotencia?: string | null;
  fetchImpl?: typeof fetch;
  /** Testes trocam a resolução de DNS. Produção nunca passa isto. */
  conferirDestino?: (hostname: string) => Promise<void>;
};

function montarCabecalhos(o: OpcoesDaChamada): Record<string, string> | { erro: string } {
  const h: Record<string, string> = { Accept: "application/json" };
  if (o.corpo !== null) h["Content-Type"] = "application/json";
  if (o.idempotencia) h["Idempotency-Key"] = o.idempotencia;

  const precisaSegredo = o.auth.auth_tipo !== "nenhuma";
  if (precisaSegredo && !o.segredo) return { erro: "sem_segredo" };
  const segredo = o.segredo ?? "";

  switch (o.auth.auth_tipo) {
    case "nenhuma":
      break;
    case "bearer":
      h.Authorization = `Bearer ${segredo}`;
      break;
    case "header":
      if (!o.auth.auth_header_nome) return { erro: "sem_nome_do_cabecalho" };
      h[o.auth.auth_header_nome] = segredo;
      break;
    case "hmac_sha256": {
      // Mesmo formato do Back Office: `sha256=HMAC(segredo, "{ts}.{corpo}")`.
      const ts = String(Math.floor(Date.now() / 1000));
      h["X-Timestamp"] = ts;
      h["X-Signature"] = `sha256=${createHmac("sha256", segredo).update(`${ts}.${o.corpo ?? ""}`).digest("hex")}`;
      break;
    }
    case "suporte_v1":
      Object.assign(
        h,
        cabecalhosAssinados({
          segredo,
          metodo: o.metodo,
          url: o.url,
          corpo: o.corpo,
          requestId: randomUUID(),
          emailVerificado: o.emailVerificado ?? null,
          idempotencia: o.idempotencia ?? null,
        }),
      );
      break;
  }
  return h;
}

async function lerComTeto(res: Response): Promise<{ texto: string; bytes: number } | { estourou: true; bytes: number }> {
  if (!res.body) return { texto: "", bytes: 0 };
  const reader = res.body.getReader();
  const pedacos: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > TETO_DE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { estourou: true, bytes };
    }
    pedacos.push(value);
  }
  return { texto: Buffer.concat(pedacos.map((p) => Buffer.from(p))).toString("utf8"), bytes };
}

function falha(codigo: string, inicio: number, status: number | null = null, bytes = 0): RespostaDaChamada {
  return {
    ok: false,
    http_status: status,
    dados: null,
    erro_codigo: codigo,
    duracao_ms: Date.now() - inicio,
    bytes_resposta: bytes,
  };
}

export async function chamarEndpoint(o: OpcoesDaChamada): Promise<RespostaDaChamada> {
  const inicio = Date.now();

  try {
    assertSafeOutboundUrl(o.url);
    await (o.conferirDestino ?? assertDestinoResolvidoSeguro)(new URL(o.url).hostname);
  } catch (err) {
    return falha(err instanceof Error ? err.message : "unsafe_url", inicio);
  }

  const cabecalhos = montarCabecalhos(o);
  if ("erro" in cabecalhos && typeof cabecalhos.erro === "string") {
    return falha(cabecalhos.erro, inicio);
  }

  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(o.url, {
      method: o.metodo,
      headers: cabecalhos as Record<string, string>,
      body: o.corpo ?? undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(o.timeoutMs),
    });
  } catch (err) {
    const nome = err instanceof Error ? err.name : "";
    return falha(nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "rede", inicio);
  }

  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    return falha("redirect_nao_seguido", inicio, res.status);
  }

  let lido: Awaited<ReturnType<typeof lerComTeto>>;
  try {
    lido = await lerComTeto(res);
  } catch {
    return falha("leitura_interrompida", inicio, res.status);
  }
  if ("estourou" in lido) return falha("resposta_grande_demais", inicio, res.status, lido.bytes);

  let dados: unknown = null;
  if (lido.texto.length > 0) {
    try {
      dados = JSON.parse(lido.texto);
    } catch {
      dados = lido.texto.slice(0, 2048);
    }
  }

  return {
    ok: res.ok,
    http_status: res.status,
    dados,
    erro_codigo: res.ok ? null : `http_${res.status}`,
    duracao_ms: Date.now() - inicio,
    bytes_resposta: lido.bytes,
  };
}

/**
 * Mensagem legível para o código de erro — o que a tela mostra no "Testar" e
 * o que o modelo recebe para explicar ao cliente sem inventar.
 */
export function explicarErro(codigo: string | null): string {
  if (!codigo) return "";
  if (codigo.startsWith("unsafe_url:https_required")) return "A URL precisa começar com https://.";
  if (codigo.startsWith("unsafe_url:private") || codigo.startsWith("unsafe_url:ipv6"))
    return "Endereço interno ou privado não é permitido — use o endereço público do sistema.";
  if (codigo.startsWith("unsafe_url:dns")) return "O endereço do sistema não foi encontrado (DNS).";
  if (codigo.startsWith("unsafe_url")) return "URL inválida para chamada externa.";
  if (codigo === "timeout") return "O sistema demorou demais para responder.";
  if (codigo === "rede") return "Não foi possível conectar ao sistema.";
  if (codigo === "redirect_nao_seguido") return "O sistema respondeu com redirecionamento, que não é seguido por segurança.";
  if (codigo === "resposta_grande_demais") return "A resposta passou de 256 KB.";
  if (codigo === "sem_segredo") return "Falta cadastrar a chave de acesso da integração.";
  if (codigo === "http_401" || codigo === "http_403") return "O sistema recusou a chave de acesso.";
  if (codigo === "http_404") return "Endereço não encontrado no sistema.";
  if (codigo.startsWith("http_5")) return "O sistema está com erro interno.";
  if (codigo.startsWith("http_")) return `O sistema respondeu com erro (${codigo.slice(5)}).`;
  return codigo;
}
