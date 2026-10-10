/**
 * POST /api/v1/ai/agents/construtor/entrevistar — "Criar agente com IA",
 * passo das perguntas.
 *
 * Lê o que o dono colou (e as respostas que ele já deu) e devolve OU uma
 * rodada de até 4 perguntas, OU o sinal de que já dá para montar. Nunca
 * escreve no banco: quem cria é `construtor/criar`, depois da revisão.
 *
 * O teto de rodadas é do SERVIDOR, não do modelo: na última o prompt manda
 * encerrar e, se o modelo insistir em perguntar, a resposta é convertida em
 * "pronto" aqui. Entrevista que não acaba é a forma mais rápida de a pessoa
 * desistir — o que faltou vira lacuna, e o agente passa esse assunto para uma
 * pessoa.
 *
 * Molde: `app/api/v1/flows/[id]/ai/interpretar/route.ts` (porta com fallback,
 * orçamento antes de gastar, logs de início/fim/falha com causa).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import {
  entradaDaEntrevistaSchema,
  normalizarEntrevista,
  RESUMO_PADRAO,
  saidaDaEntrevistaSchema,
} from "@/lib/ai/agents/construtor/esquemas";
import { MAX_RODADAS, promptDaEntrevista } from "@/lib/ai/agents/construtor/entrevista";
import { nichoDoTexto } from "@/lib/ai/agents/construtor/nicho";
import { pedidoAoModelo } from "@/lib/ai/agents/construtor/pedido";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { causaDe, portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";

export const dynamic = "force-dynamic";
/** Vale na Vercel; no self-host quem limita é o proxy (ver a rota irmã de fluxo). */
export const maxDuration = 120;

const PURPOSE = "agent_builder_entrevistar";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const corpo = await req.json().catch(() => ({}));
  const lido = entradaDaEntrevistaSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", "Conte um pouco mais sobre o negócio (pelo menos algumas frases).", 422, {
      requestId,
      details: lido.error.flatten(),
    });
  }
  const { material, historico, rodada } = lido.data;

  const orcamento = await orcamentoPermite(orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, { requestId });
  }

  const cadeia = await resolverCadeia(PURPOSE, orgId);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  const nicho = nichoDoTexto(material);
  const t0 = Date.now();
  logger.info("agent_builder.entrevistar.inicio", {
    organizationId: orgId,
    requestId,
    rodada,
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
  });

  try {
    const porta = portaComFallback(cadeia, { organizationId: orgId, requestId });
    const resposta = await porta.objeto({
      schema: saidaDaEntrevistaSchema,
      system: promptDaEntrevista(nicho, rodada),
      prompt: pedidoAoModelo(material, historico),
      rotulo: `entrevistar:r${rodada}`,
      sinal: req.signal,
      maxOutputTokens: 1500,
    });

    if (!resposta.ok || resposta.objeto === undefined) {
      logger.error("agent_builder.entrevistar.falhou", {
        organizationId: orgId,
        requestId,
        ms: Date.now() - t0,
        modeloCanonico: resposta.modeloUsado,
        causa: resposta.causa ?? "sem causa",
        finishReason: resposta.finishReason,
        warnings: resposta.avisos,
      });
      return fail("ai_provider_error", resposta.causa ?? "A IA não respondeu. Tente de novo.", 502, {
        requestId,
        details: { causa: resposta.causa },
      });
    }

    let saida = normalizarEntrevista(resposta.objeto);
    // Última rodada: o servidor encerra mesmo que o modelo queira perguntar.
    if (saida.kind === "perguntar" && rodada >= MAX_RODADAS) {
      saida = { kind: "pronto", resumo: RESUMO_PADRAO, nicho: saida.nicho };
    }
    if (saida.kind === "pronto" && saida.degradada !== undefined) {
      // Não é mais erro para a pessoa (ver `normalizarEntrevista`), mas segue
      // sendo o modelo descumprindo o contrato — e quem ajusta o prompt precisa
      // ver com que frequência. Só a FORMA vai a log: o material é do cliente.
      const bruto = resposta.objeto;
      logger.warn("agent_builder.entrevistar.encerrada_sem_contrato", {
        organizationId: orgId,
        requestId,
        rodada,
        motivo: saida.degradada,
        kind_do_modelo: bruto.kind,
        perguntas_recebidas: bruto.perguntas?.length ?? 0,
        resumo_chars: (bruto.resumo ?? "").trim().length,
        modeloCanonico: resposta.modeloUsado,
        finishReason: resposta.finishReason,
      });
      const { degradada: _degradada, ...semMarca } = saida;
      saida = semMarca;
    }

    logger.info("agent_builder.entrevistar.fim", {
      requestId,
      ms: Date.now() - t0,
      kind: saida.kind,
      finishReason: resposta.finishReason,
      warnings: resposta.avisos,
      usouReserva: resposta.usouReserva,
      tokens_entrada: resposta.tokensEntrada,
      tokens_saida: resposta.tokensSaida,
    });
    return ok({ ...saida, nicho: saida.nicho ?? nicho, rodada, max_rodadas: MAX_RODADAS }, { requestId });
  } catch (err) {
    logger.error("agent_builder.entrevistar.falhou", {
      organizationId: orgId,
      requestId,
      ms: Date.now() - t0,
      modeloCanonico: cadeia.primario.modelId,
      causa: causaDe(err),
    });
    return fail("ai_provider_error", "Não consegui ler o que você contou. Tente de novo.", 502, {
      requestId,
      details: { causa: causaDe(err) },
    });
  }
}
