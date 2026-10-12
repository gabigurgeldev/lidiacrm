/**
 * POST /api/v1/ai/agents/:id/correcao/propor — "Corrigir com IA", passo 2.
 *
 * Com o diagnóstico e as respostas do dono, a IA devolve o prompt corrigido
 * INTEIRO e as mudanças em materiais, capacidades e frases de passagem, cada
 * uma com o porquê. A proposta é aparada contra a versão base
 * (`normalizarProposta`) e o prompt novo passa pela mesma conferência do
 * construtor — mostrando só o que a correção piorou.
 *
 * Devolve também o conteúdo da versão base: a tela monta com ele a versão
 * proposta para o "Testar a correção" (ensaio), sem salvar nada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { capacidadesPorPacote } from "@/lib/ai/agents/capacidades-padrao";
import { metaPromptDoAgente } from "@/lib/ai/agents/construtor/doutrina";
import { nichoDoTexto } from "@/lib/ai/agents/construtor/nicho";
import { fonteDosFatos } from "@/lib/ai/agents/construtor/pedido";
import { verificarPrompt } from "@/lib/ai/agents/construtor/verificacao";
import { carregarContextoDaCorrecao } from "@/lib/ai/agents/correcao/contexto";
import { entradaDaPropostaSchema, saidaDaPropostaSchema } from "@/lib/ai/agents/correcao/esquemas";
import { achadosNovos, normalizarProposta, pacotesLigados, ferramentasCorrigidas } from "@/lib/ai/agents/correcao/montar";
import {
  descreverContexto,
  descreverDiagnostico,
  descreverPedido,
  instrucoesDaProposta,
} from "@/lib/ai/agents/correcao/prompts";
import { createAdminClient } from "@/lib/supabase/admin";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { causaDe, portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PURPOSE = "agent_builder_corrigir";
const TOKENS = 16_000;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id: agentId } = await ctx.params;
  if (!UUID_RX.test(agentId)) return fail("invalid_request", "Agente inválido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const lido = entradaDaPropostaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Não entendi o pedido de correção.", 422, { requestId, details: lido.error.flatten() });
  }
  const { problema, conversation_id, anexos, historico, diagnostico } = lido.data;

  const admin = createAdminClient();
  const contexto = await carregarContextoDaCorrecao(admin, orgId, agentId, { conversationId: conversation_id });
  if (!contexto.ok) return fail(contexto.code, contexto.message, contexto.status, { requestId });
  const c = contexto.contexto;

  const orcamento = await orcamentoPermite(orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, { requestId });
  }
  const cadeia = await resolverCadeia(PURPOSE, orgId, DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  const mapa = capacidadesPorPacote();
  const promptBase = String(c.base.bruta.system_prompt ?? "");
  const ferramentasBase = (c.base.bruta.tool_ids as string[] | null) ?? [];
  const nicho = nichoDoTexto(`${promptBase}\n${problema}`);

  const t0 = Date.now();
  try {
    const porta = portaComFallback(cadeia, { organizationId: orgId, requestId });
    const resposta = await porta.objeto({
      schema: saidaDaPropostaSchema,
      system: instrucoesDaProposta(metaPromptDoAgente(nicho)),
      prompt: [descreverContexto(c, mapa), descreverDiagnostico(diagnostico), "", descreverPedido(problema, historico, anexos)].join(
        "\n",
      ),
      rotulo: "corrigir:propor",
      sinal: req.signal,
      maxOutputTokens: TOKENS,
    });
    if (!resposta.ok || resposta.objeto === undefined) {
      logger.error("agent_builder.corrigir.propor.falhou", {
        organizationId: orgId,
        requestId,
        ms: Date.now() - t0,
        causa: resposta.causa ?? "sem causa",
        finishReason: resposta.finishReason,
      });
      return fail("ai_provider_error", resposta.causa ?? "A IA não conseguiu propor a correção. Tente de novo.", 502, {
        requestId,
      });
    }

    const proposta = normalizarProposta(resposta.objeto, {
      id: c.base.id,
      system_prompt: promptBase,
      handoff_keywords: (c.base.bruta.handoff_keywords as string[] | null) ?? [],
      materiais: c.materiais.map((m) => ({ id: m.id, nome: m.nome })),
    });

    // Fato só vale se veio do agente de hoje, do relato, das respostas, dos
    // arquivos ou dos materiais — preço novo que não está em nenhum deles é
    // "fato inventado" (erro na conferência).
    const fonte = fonteDosFatos(
      [promptBase, problema, ...c.materiais.map((m) => m.amostra)].join("\n"),
      historico,
      anexos,
    );
    const pacotesDepois = pacotesLigados(
      new Set(
        ferramentasCorrigidas(
          ferramentasBase,
          proposta.pacotes_ligar.map((p) => p.valor),
          proposta.pacotes_desligar.map((p) => p.valor),
          mapa,
        ),
      ),
      mapa,
    );
    const verificacao = achadosNovos(
      verificarPrompt({ prompt: promptBase, fonte, pacotes: pacotesLigados(new Set(ferramentasBase), mapa) }),
      verificarPrompt({ prompt: proposta.system_prompt, fonte, pacotes: pacotesDepois }),
    );

    logger.info("agent_builder.corrigir.propor.fim", {
      requestId,
      ms: Date.now() - t0,
      usouReserva: resposta.usouReserva,
      promptMudou: proposta.system_prompt.trim() !== promptBase.trim(),
      materiaisNovos: proposta.materiais_novos.length,
      erros: verificacao.filter((a) => a.nivel === "erro").length,
    });

    return ok(
      {
        proposta,
        verificacao,
        base: {
          id: c.base.id,
          version_number: c.base.version_number,
          partiu_do_rascunho: c.partiuDoRascunho,
          /** O conteúdo da base, para a tela montar a versão do teste. null = dado legado fora do schema. */
          versao: c.base.conteudo,
        },
        materiais_ligados: c.materiais.map((m) => ({ id: m.id, nome: m.nome })),
      },
      { requestId },
    );
  } catch (err) {
    logger.error("agent_builder.corrigir.propor.falhou", { organizationId: orgId, requestId, causa: causaDe(err) });
    return fail("ai_provider_error", "Não consegui propor a correção. Tente de novo.", 502, { requestId });
  }
}
