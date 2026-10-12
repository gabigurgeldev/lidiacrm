/**
 * GET/PUT /api/v1/ai/providers/embedding — o modelo que indexa e consulta o
 * material da organização ("Seu material", no painel de Provedores).
 *
 * Por que uma rota própria, e não o PUT genérico de pontos: indexar e buscar
 * precisam do MESMO modelo (são coordenadas do mesmo mapa), então os dois
 * pontos são gravados juntos, numa escrita só — e trocar o modelo pede
 * reindexação de todo o material. O PUT genérico recusa esses dois pontos
 * (`ponto_vinculado`), para nenhum caminho gravar um sem o outro.
 *
 * GET devolve a situação: o modelo em vigor, quantos materiais já estão nele e,
 * com `?provider=&model_id=`, quanto custaria trocar. Não muda nada.
 *
 * PUT grava a troca, nesta ordem: valida, confere a chave, PROVA o modelo com
 * uma chamada de verdade (1536 dimensões), grava os dois pontos, pede a
 * reindexação pelo `event_log` e audita. Se a prova falhar, nada é gravado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import {
  CATALOGO_DE_EMBEDDING,
  MAPA_LEGADO,
  PROVEDORES_DE_EMBEDDING,
  ehProvedorDeEmbedding,
  modeloDoBinding,
  rotuloDoMapa,
  type ModeloDeEmbedding,
} from "@/lib/ai/embeddings/catalogo";
import { resolverChaveDeEmbedding, EXPLICACAO_DA_ORIGEM } from "@/lib/ai/embeddings/chave";
import { provarModeloDeEmbedding } from "@/lib/ai/embeddings/prova";
import { pedirReindexacao, situacaoDoAcervo } from "@/lib/ai/embeddings/reindexacao";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PONTOS = ["embedding_indexar", "embedding_consultar"] as const;

function modeloDaEscolha(provider: string, modelId: string): ModeloDeEmbedding | null {
  return modeloDoBinding({ provider, model_id: modelId });
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const chave = await resolverChaveDeEmbedding(orgId, "embedding_indexar");
  const { data: binding } = await admin
    .from("ai_purpose_bindings")
    .select("provider, model_id, credential_id")
    .eq("organization_id", orgId)
    .eq("purpose", "embedding_indexar")
    .eq("is_enabled", true)
    .maybeSingle();
  const escolhido = modeloDoBinding((binding as { provider: string; model_id: string } | null) ?? null);
  const mapaAtual = escolhido?.mapa ?? MAPA_LEGADO;

  const provider = req.nextUrl.searchParams.get("provider");
  const modelId = req.nextUrl.searchParams.get("model_id");
  const candidato = provider && modelId ? modeloDaEscolha(provider, modelId) : null;

  const [situacao, estimativa] = await Promise.all([
    situacaoDoAcervo(admin, orgId, mapaAtual),
    candidato && candidato.mapa !== mapaAtual ? situacaoDoAcervo(admin, orgId, candidato.mapa) : Promise.resolve(null),
  ]);

  return ok(
    {
      atual: {
        mapa: mapaAtual,
        rotulo: rotuloDoMapa(mapaAtual),
        provider: escolhido?.provedor ?? chave?.provedor ?? null,
        model_id: escolhido?.idNoProvedor ?? chave?.modelo.idNoProvedor ?? null,
        credential_id: (binding as { credential_id?: string | null } | null)?.credential_id ?? null,
        escolhido_no_painel: escolhido !== null,
        chave: chave
          ? { origem: chave.origem, explicacao: EXPLICACAO_DA_ORIGEM[chave.origem], provedor: chave.provedor, avisos: chave.avisos }
          : null,
      },
      progresso: { materiais: situacao.materiais, no_modelo_atual: situacao.noAlvo },
      estimativa: estimativa
        ? {
            mapa: estimativa.mapaAlvo,
            materiais_para_reindexar: estimativa.foraDoAlvo.length,
            trechos: estimativa.trechos,
            tokens: estimativa.tokens,
            custo_estimado_centavos: estimativa.custoEstimadoCentavos,
          }
        : null,
      catalogo: CATALOGO_DE_EMBEDDING.map((m) => ({
        mapa: m.mapa,
        rotulo: m.rotulo,
        quando_usar: m.quandoUsar,
        centavos_por_milhao: m.centavosPorMilhao,
        provedores: Object.entries(m.provedores).map(([p, v]) => ({ provider: p, model_id: v!.idNoProvedor })),
      })),
      provedores: PROVEDORES_DE_EMBEDDING,
      pode_editar: roleAtLeast(authz.org.role, "admin"),
    },
    { requestId },
  );
}

const corpoDoPut = z.strictObject({
  provider: z.string().refine(ehProvedorDeEmbedding, { message: "provedor de embedding inválido" }),
  model_id: z.string().trim().min(1).max(200),
  credential_id: z.string().uuid().nullable().optional(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const lido = corpoDoPut.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("invalid_body", "corpo inválido", 422, { requestId, details: lido.error.issues });
  }
  const corpo = lido.data;

  const modelo = modeloDaEscolha(corpo.provider, corpo.model_id);
  if (!modelo) {
    return fail(
      "modelo_nao_e_embedding",
      `"${corpo.model_id}" não parece um modelo de embedding. Escolha um da lista ou digite um id que contenha "embed".`,
      422,
      { requestId },
    );
  }

  // A credencial precisa ser DESTA organização e do MESMO provedor.
  const db = await createClient();
  if (corpo.credential_id) {
    const { data: cred } = await db
      .from("ai_provider_credentials")
      .select("id, provider")
      .eq("id", corpo.credential_id)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (!cred) return fail("credencial_invalida", "chave não encontrada nesta organização", 422, { requestId });
    if (cred.provider !== corpo.provider) {
      return fail(
        "credencial_de_outro_provedor",
        `a chave escolhida é de ${cred.provider}, mas o modelo é servido por ${corpo.provider}.`,
        422,
        { requestId },
      );
    }
  }

  const prova = await provarModeloDeEmbedding(org.orgId, modelo, corpo.credential_id ?? null);
  if (!prova.ok) return fail(prova.codigo, prova.mensagem, prova.status, { requestId });

  const admin = createAdminClient();
  const { data: anterior } = await admin
    .from("ai_purpose_bindings")
    .select("provider, model_id")
    .eq("organization_id", org.orgId)
    .eq("purpose", "embedding_indexar")
    .eq("is_enabled", true)
    .maybeSingle();
  const mapaAnterior = modeloDoBinding((anterior as { provider: string; model_id: string } | null) ?? null)?.mapa ?? MAPA_LEGADO;

  // Os dois pontos numa escrita só: um sem o outro é material indexado num
  // mapa e consultado noutro — o agente para de achar tudo, sem erro.
  const { data: gravados, error } = await db
    .from("ai_purpose_bindings")
    .upsert(
      PONTOS.map((purpose) => ({
        organization_id: org.orgId,
        purpose,
        provider: modelo.provedor,
        model_id: modelo.idNoProvedor,
        credential_id: corpo.credential_id ?? null,
        base_url: null,
        is_enabled: true,
      })),
      { onConflict: "organization_id,purpose" },
    )
    .select("id, purpose");
  if (error) return fail("save_failed", error.message, 500, { requestId });
  if (!gravados || gravados.length !== PONTOS.length) {
    return fail("save_failed", "nada foi gravado — verifique as permissões da organização", 500, { requestId });
  }

  let reindexar = 0;
  let custo: number | null = 0;
  if (modelo.mapa !== mapaAnterior) {
    const situacao = await situacaoDoAcervo(admin, org.orgId, modelo.mapa);
    custo = situacao.custoEstimadoCentavos;
    reindexar = await pedirReindexacao(admin, org.orgId, situacao.foraDoAlvo, modelo.mapa, "troca_no_painel");
    if (reindexar < situacao.foraDoAlvo.length) {
      logger.warn("[embedding] parte da reindexação não foi enfileirada; o cron diário reconcilia", {
        organization_id: org.orgId,
        pedidos: situacao.foraDoAlvo.length,
        aceitos: reindexar,
      });
    }
  }

  void audit({
    action: "ai.embedding_model_changed",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "ai_purpose_binding",
    resourceId: (gravados[0] as { id?: string }).id ?? null,
    metadata: {
      de: mapaAnterior,
      para: modelo.mapa,
      provider: modelo.provedor,
      model_id: modelo.idNoProvedor,
      do_catalogo: modelo.doCatalogo,
      materiais_para_reindexar: reindexar,
      custo_estimado_centavos: custo,
    },
    requestId,
  });

  return ok(
    {
      mapa: modelo.mapa,
      rotulo: rotuloDoMapa(modelo.mapa),
      mudou_de_modelo: modelo.mapa !== mapaAnterior,
      materiais_para_reindexar: reindexar,
      custo_estimado_centavos: custo,
      avisos: modelo.doCatalogo
        ? []
        : ["Modelo fora da nossa lista: ele entrega 1536 dimensões, mas a qualidade da busca com ele não foi medida."],
    },
    { requestId },
  );
}
