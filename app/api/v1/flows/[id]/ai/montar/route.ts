/**
 * POST /api/v1/flows/[id]/ai/montar — ETAPA 2: preenche cada bloco, ao vivo.
 *
 * ═══ Por que aqui pode ser stream, e na etapa 1 não podia ═══
 *
 * Depois desta linha não existe mais falha fatal. Todo erro conhecido —
 * provedor fora do ar, orçamento, plano inválido, nenhum provedor configurado —
 * já foi respondido com status HTTP pela rota `plano`. O que sobra é uma
 * sequência de chamadas pequenas, e a que falhar cai no `configExemploDoTipo`:
 * o pior caso desta rota é um grafo com alguns blocos em valores padrão, nunca
 * uma tela vazia. Por isso abrir os cabeçalhos 200 aqui é seguro, e era
 * exatamente o que NÃO era seguro no caminho anterior, que abria o stream antes
 * de saber se o provedor sequer existia.
 *
 * ═══ O plano vem no corpo — e é revalidado ═══
 *
 * Não é buraco de tenancy: `organization_id` continua saindo de `requireRole`
 * (cookie/JWT), nunca do corpo. O plano é dado de CONTEÚDO, e é conferido
 * contra o Zod e contra o registry antes de qualquer uso — um `tipo` que não
 * existe é descartado, não executado.
 *
 * ═══ Sem escrita no banco ═══
 *
 * Devolve o grafo e nada mais. Quem persiste é o "Salvar rascunho" de sempre
 * (`PATCH /api/v1/flows/[id]`), igual a um fluxo montado à mão — nada de
 * caminho de gravação paralelo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import {
  CABECALHOS_SSE,
  HEARTBEAT,
  HEARTBEAT_MS,
  serializarEvento,
  type EventoDeGeracao,
} from "@/lib/flow-engine/ai/eventos";
import { gerarConfigs } from "@/lib/flow-engine/ai/etapas";
import { portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";
import { montarSchemaDePlano, type PlanoDeFluxo } from "@/lib/flow-engine/ai/plan-schema";
import { planoParaGrafo, type ConfigResolvida } from "@/lib/flow-engine/ai/plan-to-graph";

export const dynamic = "force-dynamic";

/**
 * VALE NA VERCEL, NÃO NO SELF-HOST. Em `output: "standalone"` quem limita é o
 * proxy à frente — e é o heartbeat, não este número, que impede o corte lá.
 */
export const maxDuration = 300;

const PURPOSE = "flow_ai_gerar";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id: flowId } = await ctx.params;

  const entradaSchema = z.strictObject({
    pedido: z.string().trim().min(1).max(2000),
    plano: montarSchemaDePlano(),
  });
  const lido = entradaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "O plano do fluxo veio inválido.", 422, { requestId });
  }

  const orcamento = await orcamentoPermite(authz.org.orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, {
      requestId,
    });
  }

  const cadeia = await resolverCadeia(PURPOSE, authz.org.orgId);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  // O fluxo precisa ser DESTA organização antes de virar `resourceId` de uma
  // linha de auditoria. A rota antiga auditava o id que viesse no caminho, sem
  // conferir: não vazava dado (ela não lê o fluxo), mas sujava o
  // `api_audit_log` com id alheio — e audit log é append-only, então a sujeira
  // fica. Service role bypassa RLS: o filtro por organização é manual, de fonte
  // confiável (o cookie), nunca do corpo.
  const admin = createAdminClient();
  const { data: fluxo } = await admin
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!fluxo) {
    return fail("not_found", "Fluxo não encontrado.", 404, { requestId });
  }

  const plano: PlanoDeFluxo = lido.data.plano;
  const t0 = Date.now();
  logger.info("flow.ai.montar.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
    blocos: plano.blocos.length,
  });

  const porta = portaComFallback(cadeia, {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
  });

  const codificador = new TextEncoder();
  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const enviar = (evento: EventoDeGeracao) => {
        try {
          controle.enqueue(codificador.encode(serializarEvento(evento)));
        } catch {
          // Cliente já foi embora. `req.signal` cuida de parar as chamadas.
        }
      };
      // Bytes a cada 10s: é o que impede um proxy de cortar a conexão por
      // ociosidade sem exigir diretiva nova no Caddyfile de quem já instalou.
      const pulso = setInterval(() => {
        try {
          controle.enqueue(codificador.encode(HEARTBEAT));
        } catch {
          /* idem */
        }
      }, HEARTBEAT_MS);

      try {
        // O esqueleto primeiro: o canvas desenha o fluxo INTEIRO em segundos, e
        // os blocos acendem depois. No caminho antigo os nós pingavam um a um
        // durante todo o tempo da chamada, e um erro no fim apagava todos.
        enviar({ tipo: "plano", blocos: plano.blocos, ligacoes: plano.ligacoes });

        const { configs, telemetria } = await gerarConfigs(
          porta,
          plano,
          lido.data.pedido,
          { sinal: req.signal },
          ({ id, resolvida, restantes }) => {
            enviar({ tipo: "bloco", id, origem: resolvida.origem, restantes });
          },
        );

        const montado = planoParaGrafo(plano, configs as ReadonlyMap<string, ConfigResolvida>);
        if (!montado.valido) {
          logger.error("flow.ai.montar.grafo_invalido", {
            organizationId: authz.org.orgId,
            requestId,
            flowId,
            ms: Date.now() - t0,
            causa: montado.descartes.map((d) => `${d.o_que}: ${d.motivo}`).join(" | "),
            finishReason: telemetria.finishReasons,
            warnings: telemetria.warnings,
          });
          enviar({
            tipo: "erro",
            codigo: "grafo_invalido",
            mensagem: "Não sobrou nenhum bloco válido no plano. Tente descrever de outro jeito.",
          });
          void audit({
            action: "flow.ai_generation_failed",
            actorUserId: authz.user.id,
            organizationId: authz.org.orgId,
            resourceType: "flow",
            resourceId: flowId,
            requestId,
            metadata: { onde: "montagem", descartes: montado.descartes.slice(0, 10) },
          });
          return;
        }

        enviar({ tipo: "grafo", grafo: montado.grafo });
        enviar({
          tipo: "fim",
          nos: montado.grafo.nodes.length,
          arestas: montado.grafo.edges.length,
          comExemplo: montado.comExemplo,
        });

        logger.info("flow.ai.montar.fim", {
          organizationId: authz.org.orgId,
          requestId,
          flowId,
          ms: Date.now() - t0,
          modeloCanonico: cadeia.primario.modelId,
          nos: montado.grafo.nodes.length,
          arestas: montado.grafo.edges.length,
          // Contagem separada de propósito: "montou" com metade dos blocos em
          // valores padrão é um resultado diferente de "montou", e um número
          // que sobe aqui acusa provedor recusando o formato de config.
          comExemplo: montado.comExemplo,
          descartes: montado.descartes.length,
          chamadas: telemetria.chamadas,
          // Agregado: um punhado de "length" acusa teto de tokens curto por
          // config; um "erro" repetido acusa provedor recusando o formato.
          finishReason: telemetria.finishReasons,
          warnings: telemetria.warnings,
        });
        void audit({
          action: "flow.ai_generated",
          actorUserId: authz.user.id,
          organizationId: authz.org.orgId,
          resourceType: "flow",
          resourceId: flowId,
          requestId,
          metadata: {
            nos: montado.grafo.nodes.length,
            arestas: montado.grafo.edges.length,
            comExemplo: montado.comExemplo,
            modelo: cadeia.primario.modelId,
          },
        });
      } catch (err) {
        // Só chega aqui o inesperado: `gerarConfigs` não lança por bloco, e a
        // montagem é determinística. Ainda assim, um throw sem este bloco
        // viraria stream truncado sem uma linha em lugar nenhum — que é a
        // doença que esta frente veio curar.
        logger.error("flow.ai.montar.estourou", {
          organizationId: authz.org.orgId,
          requestId,
          flowId,
          ms: Date.now() - t0,
          causa: err instanceof Error ? err.message : String(err),
        });
        enviar({
          tipo: "erro",
          codigo: "erro_interno",
          mensagem: "A montagem falhou no meio. Tente de novo.",
        });
      } finally {
        clearInterval(pulso);
        try {
          controle.close();
        } catch {
          /* já fechado pelo cliente */
        }
      }
    },
  });

  return new Response(corpo, {
    status: 200,
    headers: { ...CABECALHOS_SSE, "X-Request-Id": requestId },
  });
}
