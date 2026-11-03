/**
 * /api/v1/agente — a assistente de suporte in-app (a bolinha no canto).
 *
 *   GET  → estado do widget: quantas perguntas hoje, o limite, e a conversa mais
 *          recente para reabrir o painel onde a pessoa parou.
 *   POST → uma pergunta; responde em texto (sem streaming). Lógica em `./_handler.ts`.
 *
 * ── Escopo ───────────────────────────────────────────────────────────────────
 *
 * `requireRole("viewer")` SEM `allowPlatformAdmin`: a organização é a ativa da
 * sessão, escolhida entre as MEMBERSHIPS (`resolveActiveOrg`), e o papel é o
 * efetivo do banco. Platform admin sem membership leva 403 aqui — ele não herda
 * pela assistente o "vê tudo" que a RLS lhe dá. De quebra vêm o gate de MFA da
 * sessão e o de assinatura, os mesmos de qualquer rota do app.
 *
 * Nada do corpo decide escopo: o corpo tem a pergunta e, no máximo, o id de uma
 * conversa — que só vale se for desta pessoa nesta organização.
 *
 * ── Limite ───────────────────────────────────────────────────────────────────
 *
 * `AGENTE_LIMITE_DIARIO` perguntas por pessoa por dia (São Paulo), contadas em
 * `agente_mensagens` — 429 `rate_limited` com `Retry-After` até a meia-noite.
 *
 * ── Audit ────────────────────────────────────────────────────────────────────
 *
 * POST que respondeu grava `agente.pergunta_respondida` (fire-and-forget), com
 * ferramentas, tokens e custo — nunca o texto. GET não audita: é leitura.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { type EscopoDoAgente } from "@/agente/escopo";
import { executarFerramenta } from "@/agente/ferramentas";
import { chamarOpenRouter, ModeloIndisponivel } from "@/agente/openrouter.server";
import { registroNoBanco, type RegistroDoAgente } from "@/agente/registro.server";
import { fusoOuPadrao } from "@/agente/tempo";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { DEFAULT_VISIBILITY_MODE, type AuthUser, type VisibilityMode } from "@/lib/auth/types";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { resolverMarcaDaOrganizacao } from "@/lib/branding/organizacao";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import { corpoDaPergunta, inicioDoDiaDoLimite, responderPergunta } from "./_handler";

export const dynamic = "force-dynamic";
// 25s do laço + folga para gravar. A Vercel corta em 10s sem isto.
export const maxDuration = 30;

const MENSAGENS_NO_PAINEL = 30;

interface Sessao {
  user: AuthUser;
  escopo: EscopoDoAgente;
  nomeDaOrganizacao: string;
  nomeDoProduto: string;
}

async function sessaoDoAgente(
  requestId: string,
): Promise<{ ok: true; sessao: Sessao } | { ok: false; response: Response }> {
  const check = await requireRole("viewer", { requestId, resource: "agente" });
  if (!check.ok) return { ok: false, response: check.response };

  // Client do USUÁRIO: `organizations` é legível por membro (`orgs_select`).
  const supabase = await createClient();
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("display_name, timezone, settings")
    .eq("id", check.org.orgId)
    .maybeSingle();
  const linha = orgRow as { display_name?: string; timezone?: string | null; settings?: unknown } | null;
  const settings = (linha?.settings ?? null) as { visibility_mode?: VisibilityMode } | null;

  // A marca nunca derruba a rota: o resolvedor degrada para o padrão do produto.
  const marca = resolverMarcaDaOrganizacao(linha?.settings ?? null, await marcaDaInstalacao(), env);

  return {
    ok: true,
    sessao: {
      user: check.user,
      escopo: {
        organizationId: check.org.orgId,
        userId: check.user.id,
        role: check.org.role,
        visibilityMode: settings?.visibility_mode ?? DEFAULT_VISIBILITY_MODE,
        fuso: fusoOuPadrao(check.user.timezone ?? linha?.timezone),
      },
      nomeDaOrganizacao: linha?.display_name ?? check.org.name,
      nomeDoProduto: marca.name,
    },
  };
}

function segundosAteAmanha(agora: Date): number {
  const amanha = inicioDoDiaDoLimite(new Date(agora.getTime() + 24 * 3600_000));
  return Math.max(60, Math.ceil((amanha.getTime() - agora.getTime()) / 1000));
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const s = await sessaoDoAgente(requestId);
  if (!s.ok) return s.response;
  const { escopo } = s.sessao;

  try {
    const registro: RegistroDoAgente = registroNoBanco();
    const [usadas, conversaId] = await Promise.all([
      registro.contarPerguntas(escopo.userId, inicioDoDiaDoLimite(new Date())),
      registro.ultimaConversa(escopo.userId, escopo.organizationId),
    ]);
    const mensagens = conversaId
      ? await registro.historico(escopo.userId, conversaId, MENSAGENS_NO_PAINEL)
      : [];
    return ok(
      {
        disponivel: env.AGENTE_OPENROUTER_API_KEY.length > 0,
        usadas_hoje: usadas,
        limite: env.AGENTE_LIMITE_DIARIO,
        conversa_id: conversaId,
        mensagens: mensagens.map((m) => ({ role: m.role, content: m.content })),
      },
      { requestId },
    );
  } catch (err) {
    logger.error("agente: estado do widget falhou", {
      requestId,
      organizationId: escopo.organizationId,
      detalhe: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não foi possível carregar a assistente agora.", 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const s = await sessaoDoAgente(requestId);
  if (!s.ok) return s.response;
  const { escopo, user, nomeDaOrganizacao, nomeDoProduto } = s.sessao;

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = corpoDaPergunta.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Pergunta inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  if (!env.AGENTE_OPENROUTER_API_KEY) {
    return fail("unavailable", "A assistente não está configurada nesta instalação.", 503, {
      requestId,
    });
  }

  const agora = new Date();
  const supabase = await createClient();
  const contextoDaFerramenta = { supabase, escopo, agora };

  try {
    const resultado = await responderPergunta(escopo, parsed.data, {
      registro: registroNoBanco(),
      chamarModelo: chamarOpenRouter(env.AGENTE_OPENROUTER_API_KEY),
      executarFerramenta: (nome, args) => executarFerramenta(nome, args, contextoDaFerramenta),
      modelo: env.AGENTE_MODEL,
      limiteDiario: env.AGENTE_LIMITE_DIARIO,
      identidade: { nomeDoAgente: env.AGENTE_NOME, nomeDoProduto },
      contexto: {
        primeiroNome: user.full_name?.trim().split(/\s+/)[0] ?? null,
        papel: escopo.role,
        organizacao: nomeDaOrganizacao,
        agoraLocal: new Intl.DateTimeFormat("pt-BR", {
          timeZone: escopo.fuso,
          dateStyle: "full",
          timeStyle: "short",
        }).format(agora),
        idioma: user.idioma,
      },
      agora,
    });

    if (resultado.tipo === "limite_atingido") {
      const res = fail(
        "rate_limited",
        `Você já fez ${resultado.limite} perguntas hoje. O limite renova à meia-noite.`,
        429,
        { details: { usadas_hoje: resultado.usadas_hoje, limite: resultado.limite }, requestId },
      );
      res.headers.set("Retry-After", String(segundosAteAmanha(agora)));
      res.headers.set("X-RateLimit-Limit", String(resultado.limite));
      res.headers.set("X-RateLimit-Remaining", "0");
      return res;
    }

    void audit({
      action: "agente.pergunta_respondida",
      actorUserId: escopo.userId,
      organizationId: escopo.organizationId,
      resourceType: "agente_conversas",
      resourceId: resultado.conversa_id,
      requestId,
      metadata: {
        ferramentas: resultado.ferramentas,
        tokens_in: resultado.tokensIn,
        tokens_out: resultado.tokensOut,
        custo_usd: resultado.custoUsd,
        modelo: env.AGENTE_MODEL,
      },
    });

    const res = ok(
      {
        conversa_id: resultado.conversa_id,
        resposta: resultado.resposta,
        usadas_hoje: resultado.usadas_hoje,
        limite: resultado.limite,
      },
      { requestId },
    );
    res.headers.set("X-RateLimit-Limit", String(resultado.limite));
    res.headers.set("X-RateLimit-Remaining", String(Math.max(0, resultado.limite - resultado.usadas_hoje)));
    return res;
  } catch (err) {
    const indisponivel = err instanceof ModeloIndisponivel;
    logger.error("agente: pergunta falhou", {
      requestId,
      organizationId: escopo.organizationId,
      status: indisponivel ? err.status : null,
      detalhe: err instanceof Error ? err.message : String(err),
    });
    return fail(
      indisponivel ? "ai_provider_error" : "internal_error",
      "A assistente não conseguiu responder agora. Tente de novo em instantes.",
      indisponivel ? 503 : 500,
      { requestId },
    );
  }
}
