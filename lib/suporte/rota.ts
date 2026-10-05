/**
 * Casca das rotas `/suporte/v1/*` — este CRM como sistema CONSULTADO pelo
 * agente de suporte (Contrato de Suporte v1, `docs/integracoes/contrato-de-suporte-v1.md`).
 *
 * Ordem, e cada passo fecha uma porta:
 *
 *   1. HMAC de método + caminho + corpo com `SUPORTE_V1_SECRET`. Sem segredo
 *      configurado: 503 — a instalação de um cliente nunca expõe nada aqui.
 *   2. Em `/contas/{org}`: o e-mail de `X-Suporte-Email-Verificado` tem de
 *      administrar AQUELA organização, conferido de novo AGORA pela mesma função
 *      da busca (`fn_suporte_contas_por_email`). O CRM que chama já provou o
 *      e-mail com o código; esta é a segunda barreira — um defeito do lado de lá
 *      não alcança a conta de outra pessoa.
 *   3. Toda chamada é auditada na organização consultada, com `via: suporte_v1`.
 *
 * A organização vem do PATH, nunca do corpo. O admin client bypassa a RLS, então
 * todo handler filtra `organization_id` explicitamente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  HEADER_ASSINATURA,
  HEADER_EMAIL_VERIFICADO,
  HEADER_REQUEST_ID,
  HEADER_TIMESTAMP,
  conferirSuporteV1,
} from "./contrato";

export type RespostaDeSuporte = { status: number; body: unknown };

export function erro(status: number, codigo: string, mensagem: string): RespostaDeSuporte {
  // `ok: false` em toda recusa: o cliente do contrato lê a mesma forma nas ações e nas leituras.
  return { status, body: { ok: false, erro: { codigo, mensagem } } };
}

function json(r: RespostaDeSuporte, requestId: string | null): Response {
  return Response.json(r.body, {
    status: r.status,
    headers: { "cache-control": "no-store", ...(requestId ? { "x-request-id": requestId } : {}) },
  });
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContaDoSuporte = { organizationId: string; email: string; nome: string; papel: string };

export type ContextoDeSuporte = {
  admin: SupabaseClient;
  corpo: string;
  requestId: string | null;
  /** Presente só nas rotas `/contas/{org}`, depois da reconferência de posse. */
  conta: ContaDoSuporte | null;
};

export async function contasPorEmail(
  admin: SupabaseClient,
  email: string,
): Promise<Array<{ organization_id: string; nome: string; papel: string }>> {
  const { data, error } = await admin.rpc("fn_suporte_contas_por_email", { p_email: email });
  if (error) throw new Error(`fn_suporte_contas_por_email: ${error.message}`);
  return (data ?? []) as Array<{ organization_id: string; nome: string; papel: string }>;
}

export async function rotaDeSuporte(
  req: Request,
  opts: { orgDoCaminho?: string; auditoria: AuditAction; recurso: string },
  handler: (ctx: ContextoDeSuporte) => Promise<RespostaDeSuporte>,
): Promise<Response> {
  const corpo = await req.text();
  const url = new URL(req.url);
  const requestId = req.headers.get(HEADER_REQUEST_ID);
  const check = conferirSuporteV1({
    segredo: env.SUPORTE_V1_SECRET,
    timestamp: req.headers.get(HEADER_TIMESTAMP),
    assinatura: req.headers.get(HEADER_ASSINATURA),
    metodo: req.method,
    caminhoComQuery: `${url.pathname}${url.search}`,
    corpo,
  });
  if (!check.ok) {
    return check.motivo === "sem_segredo"
      ? json(erro(503, "not_configured", "Contrato de Suporte v1 desligado nesta instalação."), requestId)
      : json(erro(401, `signature_${check.motivo}`, "Assinatura recusada."), requestId);
  }

  const admin = createAdminClient();
  let conta: ContaDoSuporte | null = null;

  if (opts.orgDoCaminho !== undefined) {
    if (!UUID_RX.test(opts.orgDoCaminho)) {
      return json(erro(404, "conta_nao_encontrada", "Conta não encontrada."), requestId);
    }
    const email = (req.headers.get(HEADER_EMAIL_VERIFICADO) ?? "").trim().toLowerCase();
    if (!email) return json(erro(403, "email_nao_pertence_a_conta", "Falta o e-mail verificado."), requestId);
    let contas: Awaited<ReturnType<typeof contasPorEmail>>;
    try {
      contas = await contasPorEmail(admin, email);
    } catch {
      return json(erro(500, "erro_interno", "Não foi possível conferir a conta."), requestId);
    }
    const achada = contas.find((c) => c.organization_id === opts.orgDoCaminho);
    if (!achada) {
      return json(erro(403, "email_nao_pertence_a_conta", "Este e-mail não administra esta conta."), requestId);
    }
    conta = { organizationId: achada.organization_id, email, nome: achada.nome, papel: achada.papel };
  }

  let resposta: RespostaDeSuporte;
  try {
    resposta = await handler({ admin, corpo, requestId, conta });
  } catch {
    resposta = erro(500, "erro_interno", "Erro ao atender o pedido.");
  }

  if (conta) {
    void audit({
      action: opts.auditoria,
      organizationId: conta.organizationId,
      resourceType: opts.recurso,
      bypassedRls: true,
      requestId,
      metadata: {
        via: "suporte_v1",
        caminho: url.pathname,
        status: resposta.status,
        // Quem pediu é o agente de suporte em nome do dono — o e-mail fica
        // fora da trilha em claro; o papel diz com que poder.
        papel: conta.papel,
      },
    });
  }
  return json(resposta, requestId);
}

/** Corpo JSON validado; inválido vira null (a rota responde 422). */
export function lerJson<T>(
  corpo: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): T | null {
  let bruto: unknown;
  try {
    bruto = corpo.length === 0 ? {} : JSON.parse(corpo);
  } catch {
    return null;
  }
  const r = schema.safeParse(bruto);
  return r.success ? r.data : null;
}
