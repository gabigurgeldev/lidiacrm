/**
 * POST /api/v1/ai/agents/construtor/gerar — "Criar agente com IA", passo que
 * escreve o agente e os materiais de conhecimento.
 *
 * Duas chamadas em PARALELO pela porta: uma escreve o agente (prompt,
 * capacidades, gatilhos de transferência, lacunas), a outra os materiais. São
 * independentes e grandes — numa chamada só, um FAQ longo cortaria o prompt no
 * teto de tokens, ou o contrário.
 *
 * Devolve uma PRÉVIA e não escreve nada: a pessoa revisa, edita e só então
 * `construtor/criar` grava. Mesma regra do "Criar fluxo com IA".
 *
 * O modelo padrão aqui é o carro-chefe, e não o classificador como nas rotas de
 * fluxo: escrever o prompt de um atendente é trabalho de redação, não de
 * extração, e é o texto que vai falar com o cliente do dono. A escolha do
 * painel (Uso de IA › Provedores) continua vencendo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { capacidadesPorPacote, catalogoComHandler } from "@/lib/ai/agents/capacidades-padrao";
import { pacotesQueCabem } from "@/lib/ai/agents/construtor/capacidades";
import { metaPromptDoAgente, metaPromptDosMateriais } from "@/lib/ai/agents/construtor/doutrina";
import {
  agenteGeradoSchema,
  entradaDaGeracaoSchema,
  materiaisGeradosSchema,
  normalizarGeracao,
} from "@/lib/ai/agents/construtor/esquemas";
import { nichoDoTexto } from "@/lib/ai/agents/construtor/nicho";
import { pedidoAoModelo } from "@/lib/ai/agents/construtor/pedido";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { causaDe, portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PURPOSE = "agent_builder_gerar";

/** Folgado de propósito: cobra-se o token GERADO, não o autorizado (ver a porta). */
const TOKENS_DO_AGENTE = 8000;
const TOKENS_DOS_MATERIAIS = 10000;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const corpo = await req.json().catch(() => ({}));
  const lido = entradaDaGeracaoSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", "Conte um pouco mais sobre o negócio (pelo menos algumas frases).", 422, {
      requestId,
      details: lido.error.flatten(),
    });
  }
  const { material, historico } = lido.data;
  const nicho = lido.data.nicho ?? nichoDoTexto(material);

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

  const t0 = Date.now();
  logger.info("agent_builder.gerar.inicio", {
    organizationId: orgId,
    requestId,
    nicho,
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
  });

  try {
    const porta = portaComFallback(cadeia, { organizationId: orgId, requestId });
    const prompt = pedidoAoModelo(material, historico);
    const [agente, materiais] = await Promise.all([
      porta.objeto({
        schema: agenteGeradoSchema,
        system: metaPromptDoAgente(nicho),
        prompt,
        rotulo: "agente",
        sinal: req.signal,
        maxOutputTokens: TOKENS_DO_AGENTE,
      }),
      porta.objeto({
        schema: materiaisGeradosSchema,
        system: metaPromptDosMateriais(nicho),
        prompt,
        rotulo: "materiais",
        sinal: req.signal,
        maxOutputTokens: TOKENS_DOS_MATERIAIS,
      }),
    ]);

    // Sem o AGENTE não há prévia; sem os MATERIAIS há — o agente nasce sem
    // acervo e a tela diz isso. Perder a geração inteira porque o FAQ não veio
    // seria jogar fora a parte mais importante.
    if (!agente.ok || agente.objeto === undefined) {
      logger.error("agent_builder.gerar.falhou", {
        organizationId: orgId,
        requestId,
        ms: Date.now() - t0,
        parte: "agente",
        modeloCanonico: agente.modeloUsado,
        causa: agente.causa ?? "sem causa",
        finishReason: agente.finishReason,
        warnings: agente.avisos,
      });
      return fail("ai_provider_error", agente.causa ?? "A IA não conseguiu montar o agente. Tente de novo.", 502, {
        requestId,
        details: { causa: agente.causa },
      });
    }
    if (!materiais.ok) {
      logger.warn("agent_builder.gerar.materiais_falharam", {
        organizationId: orgId,
        requestId,
        causa: materiais.causa ?? "sem causa",
        finishReason: materiais.finishReason,
        warnings: materiais.avisos,
      });
    }

    const previa = normalizarGeracao(agente.objeto, materiais.objeto ?? { materiais: [] });
    // O modelo sugere pacotes em ordem de importância; liga-se enquanto cabe no
    // teto de ferramentas. O resto vai para a tela como aviso, não como erro.
    const { cabem, foraDoTeto } = pacotesQueCabem(previa.pacotes, capacidadesPorPacote(catalogoComHandler()));

    logger.info("agent_builder.gerar.fim", {
      requestId,
      ms: Date.now() - t0,
      finishReason: agente.finishReason,
      warnings: [...agente.avisos, ...materiais.avisos],
      usouReserva: agente.usouReserva || materiais.usouReserva,
      materiais: previa.materiais.length,
      tokens_saida: (agente.tokensSaida ?? 0) + (materiais.tokensSaida ?? 0),
    });

    return ok(
      {
        previa: { ...previa, pacotes: cabem },
        pacotes_fora_do_teto: foraDoTeto,
        materiais_falharam: !materiais.ok,
        nicho,
      },
      { requestId },
    );
  } catch (err) {
    logger.error("agent_builder.gerar.falhou", {
      organizationId: orgId,
      requestId,
      ms: Date.now() - t0,
      modeloCanonico: cadeia.primario.modelId,
      causa: causaDe(err),
    });
    return fail("ai_provider_error", "Não consegui montar o agente. Tente de novo.", 502, {
      requestId,
      details: { causa: causaDe(err) },
    });
  }
}
