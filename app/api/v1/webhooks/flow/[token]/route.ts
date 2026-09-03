/**
 * POST /api/v1/webhooks/flow/[token] — um sistema de fora começa um fluxo.
 *
 * ## Por que uma rota própria, e não o barramento de eventos
 *
 * Todo outro gatilho de fluxo é BROADCAST: o evento entra em `event_log` e
 * `trigger-matcher.ts` arma TODO fluxo que declarou aquele tipo. Aqui a chave é
 * a identidade — um token secreto pertence a UM fluxo, e só ele deve acordar.
 * Passar por evento exigiria um tipo sintético por fluxo, ou ensinar o matcher
 * a ler o `config` de cada nó: uma interface que todos os blocos implementam,
 * mudada por causa de um.
 *
 * ## O que ela copia de `webhooks/in/[token]`, e por quê
 *
 * Tudo o que é de segurança, porque aquela rota já pagou o preço de descobrir:
 * o `path_token` resolve a organização (fonte confiável — NUNCA o corpo), a
 * assinatura é conferida com comparação de tempo constante quando há segredo, e
 * há rate limit por token. Um caminho novo que relaxasse qualquer um destes
 * seria a porta mais fácil do produto.
 *
 * ## O que ela NÃO faz
 *
 * Não cria lead, não escreve em `event_log`, não roda o fluxo. Ela grava a
 * execução em `pending` com `next_eval_at` vencido, e o tick do motor a pega —
 * o mesmo desenho do matcher. Trabalho síncrono aqui seria um sistema de
 * terceiro esperando o nosso motor terminar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Por token, por minuto. O mesmo teto da captação de lead. */
const TETO_POR_MINUTO = 60;

interface FonteDeGatilho {
  id: string;
  organization_id: string;
  flow_id: string | null;
  kind: string;
  is_active: boolean;
  secret_encrypted: string | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const { token } = await ctx.params;

  const limite = await checkRateLimit(`flow-webhook:${token}`, TETO_POR_MINUTO, 60);
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas chamadas seguidas.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  // Cliente admin: a rota é PÚBLICA e não tem sessão. A organização sai da linha
  // do token, e toda consulta abaixo a filtra explicitamente.
  const admin = createAdminClient();
  const { data } = await admin
    .from("webhook_sources")
    .select("id, organization_id, flow_id, kind, is_active, secret_encrypted")
    .eq("path_token", token)
    .eq("kind", "flow_trigger")
    .maybeSingle();

  const fonte = data as unknown as FonteDeGatilho | null;

  // ⚠️ MESMA RESPOSTA para token inexistente, desligado e de outro tipo.
  //
  // Distinguir os casos contaria a quem está sondando qual token existe — e
  // "existe mas está desligado" é exatamente a informação que faz valer a pena
  // continuar tentando.
  if (fonte === null || !fonte.is_active || fonte.flow_id === null) {
    return fail("not_found", "Gatilho não encontrado.", 404, { requestId });
  }

  const corpoCru = await req.text();

  if (fonte.secret_encrypted !== null) {
    const segredo = await decryptWebhookSecret(admin, fonte.secret_encrypted);
    if (segredo === null) {
      logger.error("[webhook.flow] segredo ilegivel", { fonteId: fonte.id });
      return fail("internal_error", "Não consegui conferir a assinatura.", 500, { requestId });
    }
    const assinatura = req.headers.get("x-signature") ?? req.headers.get("x-hub-signature-256");
    if (!verifyInboundSignature(corpoCru, assinatura, segredo)) {
      return fail("unauthorized", "Assinatura inválida.", 401, { requestId });
    }
  }

  let payload: Record<string, unknown> = {};
  if (corpoCru.trim() !== "") {
    try {
      const lido: unknown = JSON.parse(corpoCru);
      // Corpo que não é objeto (uma lista, um número) vira `{}` em vez de
      // derrubar: o fluxo ainda pode ser útil só por ter sido chamado.
      if (typeof lido === "object" && lido !== null && !Array.isArray(lido)) {
        payload = lido as Record<string, unknown>;
      }
    } catch {
      return fail("validation_failed", "O corpo precisa ser JSON.", 422, { requestId });
    }
  }

  // A versão PUBLICADA, e o bloco de gatilho dentro dela. Rascunho não roda: um
  // fluxo despublicado com token vivo deve recusar, não rodar a versão antiga
  // sem ninguém saber qual está no ar.
  const { data: fluxoData } = await admin
    .from("flows")
    .select("id, active_version_id")
    .eq("id", fonte.flow_id)
    .eq("organization_id", fonte.organization_id)
    .maybeSingle();
  const fluxo = fluxoData as { id: string; active_version_id: string | null } | null;

  if (fluxo === null || fluxo.active_version_id === null) {
    return fail("not_found", "Este fluxo não está publicado.", 409, { requestId });
  }

  const { data: versaoData } = await admin
    .from("flow_versions")
    .select("id, graph")
    .eq("id", fluxo.active_version_id)
    .maybeSingle();
  const versao = versaoData as { id: string; graph: { nodes?: Array<{ id: string; type: string }> } } | null;

  const noDeEntrada = (versao?.graph.nodes ?? []).find((n) => n.type === "trigger.webhook");
  if (versao === null || noDeEntrada === undefined) {
    // O token existe e o fluxo publicado não tem mais o bloco: alguém o
    // removeu e republicou. Recusar é o certo — e o 409 diz que o problema
    // está aqui, não na chamada de quem chamou.
    return fail("not_found", "Este fluxo não tem mais gatilho por webhook.", 409, { requestId });
  }

  const agora = new Date().toISOString();
  const { data: criada, error } = await admin
    .from("flow_executions")
    .insert({
      organization_id: fonte.organization_id,
      flow_id: fluxo.id,
      version_id: versao.id,
      status: "pending",
      current_node_id: noDeEntrada.id,
      // Vencida AGORA: o próximo tick pega. Mesmo desenho do matcher.
      next_eval_at: agora,
      lineage: { evento: "webhook", webhook_source_id: fonte.id },
      context: {},
      // O corpo inteiro vira `{{event.*}}`. Em `input`, e não em `context`,
      // porque `context` é o rascunho que os blocos escrevem — um bloco que
      // gravasse variável com o nome de um campo do corpo apagaria o corpo.
      input: payload,
    })
    .select("id")
    .single();

  if (error !== null) {
    logger.error("[webhook.flow] nao consegui armar o fluxo", {
      fonteId: fonte.id,
      erro: error.message,
    });
    return fail("internal_error", "Não consegui começar o fluxo.", 500, { requestId });
  }

  // Melhor esforço: o carimbo é para a tela mostrar "recebido há X", e falhar
  // aqui não pode desfazer uma execução que já existe.
  await admin
    .from("webhook_sources")
    .update({ last_received_at: agora })
    .eq("id", fonte.id)
    .eq("organization_id", fonte.organization_id);

  // 201, e não 202: o wrapper de resposta do repo só emite 200/201/204, e o
  // que importa para quem chamou é que a execução EXISTE — ela roda no
  // próximo tique, como a de qualquer outro gatilho.
  return ok({ execution_id: (criada as { id: string }).id }, { requestId, status: 201 });
}
