/**
 * POST /api/v1/ai/coordenador/simular — "o que o coordenador faria com esta
 * mensagem?", sobre o RASCUNHO da tela, sem efeito nenhum. (manager+)
 *
 * Usa as mesmas funções da entrada real (`decidir`, `aplicarVeredito`). Não
 * lê nem escreve estado de conversa, não admite mensagem, não inicia fluxo, não
 * envia. Quando a decisão precisa do modelo e quem simula pediu, o decisor vai
 * pelo seam de sempre (`coordenador_decidir`): consome orçamento e fica em
 * `llm_calls`, e a tela diz isso antes do clique.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { decisorPorLlm } from "@/lib/coordenador/decisor/llm";
import { lerPainel, politicaEfetivaDoRascunho } from "@/lib/coordenador/painel";
import { politicaSchema } from "@/lib/coordenador/politica/schema";
import { simular } from "@/lib/coordenador/simular";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  politica: politicaSchema,
  cenario: z.strictObject({
    texto: z.string().trim().min(1).max(1500),
    dono: z.strictObject({
      tipo: z.enum(["nenhum", "agente", "fluxo", "pessoa"]),
      chave: z.string().max(40).nullable(),
    }),
    humano_no_comando: z.boolean().default(false),
  }),
  usar_modelo: z.boolean().default(false),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "coordenador" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const lido = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", "Cenário de simulação inválido.", 422, { requestId, details: lido.error.flatten() });
  }
  const { politica, cenario, usar_modelo } = lido.data;

  try {
    const painel = await lerPainel(createAdminClient(), orgId);
    const efetiva = politicaEfetivaDoRascunho(politica, painel.agentes, painel.fluxos);
    const decisor = usar_modelo ? decisorPorLlm(getRequestPool(), llmEdgeConfigFromEnv(env), { log: createLogger() }) : null;
    if (usar_modelo) logger.info("coordenador.simular.inicio", { requestId, orgId });
    const resultado = await simular({
      politica: efetiva,
      cenario: { texto: cenario.texto, dono: cenario.dono, humanoNoComando: cenario.humano_no_comando },
      decisor,
      organizationId: orgId,
    });
    return ok(resultado, { requestId });
  } catch (err) {
    logger.error("coordenador.simular.falhou", {
      requestId,
      orgId,
      causa: err instanceof Error ? err.message.slice(0, 200) : "erro desconhecido",
    });
    return fail("internal_error", "Não foi possível simular agora.", 500, { requestId });
  }
}
