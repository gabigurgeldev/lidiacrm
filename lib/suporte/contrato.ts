/**
 * CONTRATO DE SUPORTE v1 — a fonte única, dos dois lados.
 *
 * O agente de suporte (cliente: `lib/ai/integracoes/cliente-http.ts`) e todo
 * sistema que se deixa consultar (servidor: `lib/suporte/rota.ts` neste repo, e
 * cada sistema externo da Gestalt) falam por aqui. Spec legível em
 * `docs/integracoes/contrato-de-suporte-v1.md`, com o vetor de teste que os
 * outros repositórios copiam.
 *
 * ═══ Por que a assinatura cobre método e caminho ═══
 *
 * A do Back Office (`lib/backoffice/assinatura.ts`) assina `{ts}.{corpo}`. Num
 * GET o corpo é vazio — então UMA assinatura de GET valeria para QUALQUER GET
 * dentro da janela de 5 minutos: quem capturasse o diagnóstico da conta A
 * reaproveitaria a assinatura para pedir o da conta B. Aqui o texto assinado é
 * `{ts}.{METODO}.{caminho+query}.{corpo}`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ParametrosSchema } from "@/lib/ai/integracoes/schema";

export const VERSAO_DO_CONTRATO = "1";
export const TOLERANCIA_SEGUNDOS = 5 * 60;

export const HEADER_TIMESTAMP = "X-Suporte-Timestamp";
export const HEADER_ASSINATURA = "X-Suporte-Signature";
export const HEADER_EMAIL_VERIFICADO = "X-Suporte-Email-Verificado";
export const HEADER_REQUEST_ID = "X-Suporte-Request-Id";
export const HEADER_IDEMPOTENCIA = "Idempotency-Key";

/** O texto exato que é assinado. Exportado para o vetor de teste do doc. */
export function textoAssinado(p: {
  timestamp: string;
  metodo: string;
  caminhoComQuery: string;
  corpo: string;
}): string {
  return `${p.timestamp}.${p.metodo.toUpperCase()}.${p.caminhoComQuery}.${p.corpo}`;
}

export function assinarSuporteV1(
  segredo: string,
  p: { timestamp: string; metodo: string; caminhoComQuery: string; corpo: string },
): string {
  return `sha256=${createHmac("sha256", segredo).update(textoAssinado(p)).digest("hex")}`;
}

export type ResultadoDaConferencia =
  | { ok: true }
  | { ok: false; motivo: "sem_segredo" | "ausente" | "expirada" | "invalida" };

export function conferirSuporteV1(p: {
  segredo: string;
  timestamp: string | null;
  assinatura: string | null;
  metodo: string;
  caminhoComQuery: string;
  corpo: string;
  agoraMs?: number;
}): ResultadoDaConferencia {
  if (!p.segredo) return { ok: false, motivo: "sem_segredo" };
  if (!p.timestamp || !p.assinatura) return { ok: false, motivo: "ausente" };
  if (!/^\d{1,12}$/.test(p.timestamp)) return { ok: false, motivo: "invalida" };
  const agora = Math.floor((p.agoraMs ?? Date.now()) / 1000);
  if (Math.abs(agora - Number(p.timestamp)) > TOLERANCIA_SEGUNDOS) {
    return { ok: false, motivo: "expirada" };
  }
  const esperada = Buffer.from(
    assinarSuporteV1(p.segredo, {
      timestamp: p.timestamp,
      metodo: p.metodo,
      caminhoComQuery: p.caminhoComQuery,
      corpo: p.corpo,
    }),
  );
  const recebida = Buffer.from(p.assinatura.trim().toLowerCase());
  if (esperada.length !== recebida.length) return { ok: false, motivo: "invalida" };
  return timingSafeEqual(esperada, recebida) ? { ok: true } : { ok: false, motivo: "invalida" };
}

/** Os cabeçalhos que o cliente manda numa chamada. */
export function cabecalhosAssinados(p: {
  segredo: string;
  metodo: string;
  url: string;
  corpo: string | null;
  requestId: string;
  emailVerificado?: string | null;
  idempotencia?: string | null;
  agoraMs?: number;
}): Record<string, string> {
  const u = new URL(p.url);
  const timestamp = String(Math.floor((p.agoraMs ?? Date.now()) / 1000));
  const h: Record<string, string> = {
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_ASSINATURA]: assinarSuporteV1(p.segredo, {
      timestamp,
      metodo: p.metodo,
      caminhoComQuery: `${u.pathname}${u.search}`,
      corpo: p.corpo ?? "",
    }),
    [HEADER_REQUEST_ID]: p.requestId,
  };
  if (p.emailVerificado) h[HEADER_EMAIL_VERIFICADO] = p.emailVerificado;
  if (p.idempotencia) h[HEADER_IDEMPOTENCIA] = p.idempotencia;
  return h;
}

// ───────────────────────── as formas das respostas ─────────────────────────

export const SaudeSchema = z.object({
  ok: z.literal(true),
  sistema: z.string().min(1).max(80),
  versao_contrato: z.literal(VERSAO_DO_CONTRATO),
});

const LeituraDoCatalogoSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  titulo: z.string().min(1).max(80),
  descricao: z.string().max(600).default(""),
  metodo: z.enum(["GET", "POST"]).default("GET"),
  caminho: z.string().regex(/^\//).max(300),
  parametros: ParametrosSchema.default([]),
  campos_da_resposta: z.array(z.string().max(120)).max(40).optional(),
});

const AcaoDoCatalogoSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  titulo: z.string().min(1).max(80),
  descricao: z.string().max(600).default(""),
  parametros: ParametrosSchema.default([]),
  confirmacao: z.string().min(5).max(500),
});

export const CatalogoSchema = z.object({
  sistema: z.string().min(1).max(80),
  leituras: z.array(LeituraDoCatalogoSchema).max(30),
  acoes: z.array(AcaoDoCatalogoSchema).max(30),
});
export type Catalogo = z.infer<typeof CatalogoSchema>;

export const BuscaDeIdentidadeSchema = z.object({
  contas: z
    .array(
      z.object({
        subject_id: z.string().min(1).max(200),
        nome: z.string().max(120).default(""),
        papel: z.string().max(40).optional(),
      }),
    )
    .max(20),
});

export const VerificacaoDoDiagnosticoSchema = z.object({
  id: z.string().max(80),
  area: z.string().max(60),
  status: z.enum(["ok", "atencao", "problema"]),
  titulo: z.string().max(200),
  detalhe: z.string().max(1000).default(""),
  acao_sugerida: z
    .object({ acao: z.string().max(60), params: z.record(z.string(), z.unknown()).default({}) })
    .optional(),
});

export const DiagnosticoSchema = z.object({
  conta: z.object({ nome: z.string().max(120), status: z.string().max(60), plano: z.string().max(60).optional() }),
  verificacoes: z.array(VerificacaoDoDiagnosticoSchema).max(50),
  gerado_em: z.string(),
});
export type Diagnostico = z.infer<typeof DiagnosticoSchema>;

export const ResultadoDeAcaoSchema = z.union([
  z.object({ ok: z.literal(true), resultado: z.string().max(500) }),
  z.object({ ok: z.literal(false), erro: z.object({ codigo: z.string().max(60), mensagem: z.string().max(500) }) }),
]);

/** Caminhos fixos do contrato, relativos à base `{origem}/suporte/v1`. */
export const CAMINHOS = {
  saude: "/saude",
  catalogo: "/catalogo",
  buscarIdentidade: "/identidade/buscar",
  diagnostico: "/contas/{{conta.id}}/diagnostico",
  leitura: (slug: string) => `/contas/{{conta.id}}/${slug}`,
  acao: (slug: string) => `/contas/{{conta.id}}/acoes/${slug}`,
} as const;
