/**
 * POST /api/v1/ai/agents/construtor/entrevistar — "Criar agente com IA",
 * passo das perguntas.
 *
 * Lê o que o dono colou (e as respostas que ele já deu) e devolve OU uma
 * rodada de até 4 perguntas, OU o sinal de que já dá para montar. Nunca
 * escreve no banco: quem cria é `construtor/criar`, depois da revisão.
 *
 * ═══ Quem encerra é o servidor ═══
 *
 * O modelo devolve as perguntas E a cobertura de cada assunto do checklist,
 * com evidência. `decidirRodada` (`cobertura.ts`) aceita `pronto` só com o
 * essencial coberto — na rodada 1, só com o checklist inteiro. Se o modelo
 * encerrar cedo ou mandar rodada sem pergunta, pede-se UMA vez de novo, com o
 * que falta escrito; se ainda assim não vier pergunta, a rodada sai do próprio
 * checklist (`perguntasDeReserva`). Até 2026-10-12 três caminhos faziam a
 * entrevista sumir em silêncio — ver o cabeçalho de `cobertura.ts`.
 *
 * Rodadas: 1, 2 e 3 perguntam; a partir da 4 encerra. O que faltou vira
 * lacuna, e o agente passa esse assunto para uma pessoa.
 *
 * O modelo padrão é o carro-chefe (o mesmo de `gerar`): decidir o que falta
 * num texto colado é julgamento, não extração, e o modelo barato era o que
 * mais encerrava cedo. A escolha do painel (Provedores) continua vencendo.
 *
 * Molde: `app/api/v1/flows/[id]/ai/interpretar/route.ts` (porta com fallback,
 * orçamento antes de gastar, logs de início/fim/falha com causa).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import {
  correcaoDaRodada,
  decidirRodada,
  perguntasDeReserva,
  type DecisaoDaRodada,
} from "@/lib/ai/agents/construtor/cobertura";
import {
  entradaDaEntrevistaSchema,
  normalizarCobertura,
  normalizarEntrevista,
  RESUMO_PADRAO,
  saidaDaEntrevistaSchema,
  type EntrevistaNormalizada,
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

/** Folgado: a cobertura dos 7 assuntos com evidência não cabia em 1500. Cobra-se o gerado, não o teto. */
const TOKENS_DA_ENTREVISTA = 3000;

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

  const cadeia = await resolverCadeia(PURPOSE, orgId, DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  const nicho = lido.data.nicho ?? nichoDoTexto(material);
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
    const prompt = pedidoAoModelo(material, historico);
    const perguntarAoModelo = (correcao?: string) =>
      porta.objeto({
        schema: saidaDaEntrevistaSchema,
        system: correcao ? `${promptDaEntrevista(nicho, rodada)}\n\n${correcao}` : promptDaEntrevista(nicho, rodada),
        prompt,
        rotulo: correcao ? `entrevistar:r${rodada}:correcao` : `entrevistar:r${rodada}`,
        sinal: req.signal,
        maxOutputTokens: TOKENS_DA_ENTREVISTA,
      });

    const resposta = await perguntarAoModelo();
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

    let cobertura = normalizarCobertura(resposta.objeto);
    const primeira = decidirRodada(normalizarEntrevista(resposta.objeto), cobertura, rodada);
    let saida: EntrevistaNormalizada;
    let origem: "modelo" | "correcao" | "reserva" = "modelo";

    if (primeira.kind === "aceitar") {
      saida = primeira.saida;
    } else {
      // Só a FORMA vai a log: o material é do cliente.
      logger.warn("agent_builder.entrevistar.refeita", {
        organizationId: orgId,
        requestId,
        rodada,
        motivo: primeira.motivo,
        faltando: primeira.faltando,
        kind_do_modelo: resposta.objeto.kind,
        perguntas_recebidas: resposta.objeto.perguntas?.length ?? 0,
      });
      const segunda = await perguntarAoModelo(correcaoDaRodada(primeira));
      let decisao: DecisaoDaRodada = primeira;
      if (segunda.ok && segunda.objeto !== undefined) {
        const coberturaNova = normalizarCobertura(segunda.objeto);
        if (coberturaNova.length > 0) cobertura = coberturaNova;
        decisao = decidirRodada(normalizarEntrevista(segunda.objeto), cobertura, rodada);
      }
      if (decisao.kind === "aceitar") {
        saida = decisao.saida;
        origem = "correcao";
      } else {
        const perguntas = perguntasDeReserva(decisao.faltando);
        saida =
          perguntas.length > 0
            ? { kind: "perguntar", perguntas, nicho }
            : { kind: "pronto", resumo: RESUMO_PADRAO, nicho };
        origem = "reserva";
        logger.warn("agent_builder.entrevistar.pergunta_de_reserva", {
          organizationId: orgId,
          requestId,
          rodada,
          faltando: decisao.faltando,
          segunda_ok: segunda.ok,
        });
      }
    }

    if (saida.kind === "pronto" && saida.degradada !== undefined) {
      logger.warn("agent_builder.entrevistar.encerrada_sem_contrato", {
        organizationId: orgId,
        requestId,
        rodada,
        motivo: saida.degradada,
        modeloCanonico: resposta.modeloUsado,
      });
      const { degradada: _degradada, ...semMarca } = saida;
      saida = semMarca;
    }

    logger.info("agent_builder.entrevistar.fim", {
      requestId,
      ms: Date.now() - t0,
      kind: saida.kind,
      origem,
      finishReason: resposta.finishReason,
      warnings: resposta.avisos,
      usouReserva: resposta.usouReserva,
      tokens_entrada: resposta.tokensEntrada,
      tokens_saida: resposta.tokensSaida,
    });
    return ok(
      { ...saida, nicho: saida.nicho ?? nicho, rodada, max_rodadas: MAX_RODADAS, cobertura },
      { requestId },
    );
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
