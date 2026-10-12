/**
 * TROCAR O MODELO DO MATERIAL SEM APAGAR O MATERIAL.
 *
 * Trocar o modelo de embedding não é trocar uma configuração: os trechos já
 * indexados estão no mapa antigo, e só voltam a ser comparáveis depois de
 * reindexados no novo. Este módulo junta as três peças que fazem a troca ser
 * segura para quem não sabe o que é um vetor:
 *
 *  1. **Estimativa antes de confirmar** (`situacaoDoAcervo`): quantos
 *     materiais, quantos trechos e quanto custa, em centavos.
 *  2. **Reindexação pelo caminho de sempre** (`pedirReindexacao`): um evento
 *     `knowledge_source.updated` por material, no `event_log`, consumido pelo
 *     `rag-indexer`. Nada de trigger que faz HTTP, nada de laço na requisição.
 *  3. **Rede de segurança diária** (`reconciliarModeloDoAcervo`): o debounce
 *     do indexador, um worker parado ou uma falha de rede podem deixar material
 *     no mapa antigo; o cron diário reemite só o que ficou para trás.
 *
 * Enquanto a reindexação anda, a busca embeda a pergunta no mapa de CADA
 * material (`resolverChaveParaMapa`), então o agente segue achando tudo.
 *
 * Material do tipo `conversas` fica de fora: tem pipeline próprio, que só
 * acrescenta conversas novas — as antigas continuam achadas pelo mapa delas.
 *
 * Isolamento: toda query filtra `organization_id`, que vem da sessão (rota) ou
 * da lista de organizações do cron — nunca do corpo da requisição.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

import { MAPA_LEGADO, modeloDoBinding, precoDoMapa } from "./catalogo";

export const MOTIVO_TROCA_DE_MODELO = "troca_de_modelo";

type Admin = ReturnType<typeof createAdminClient>;

export interface MaterialDoAcervo {
  id: string;
  agent_id: string | null;
  source_type: string;
  mapa: string;
}

export interface SituacaoDoAcervo {
  mapaAlvo: string;
  materiais: number;
  noAlvo: number;
  trechos: number;
  tokens: number;
  /** `null` quando o preço do modelo não é conhecido — a tela diz "custo desconhecido", nunca 0. */
  custoEstimadoCentavos: number | null;
  foraDoAlvo: MaterialDoAcervo[];
}

/** Teto de trechos lidos para somar tokens. Acima disso a conta é proporcional. */
const TETO_DE_TRECHOS_CONTADOS = 50_000;

/** O mapa que o painel escolheu para a organização (ou o legado, sem escolha). */
export async function mapaEscolhido(admin: Admin, organizationId: string): Promise<string> {
  const { data } = await admin
    .from("ai_purpose_bindings")
    .select("provider, model_id")
    .eq("organization_id", organizationId)
    .eq("purpose", "embedding_indexar")
    .eq("is_enabled", true)
    .maybeSingle();
  return modeloDoBinding((data as { provider: string; model_id: string } | null) ?? null)?.mapa ?? MAPA_LEGADO;
}

/** Os materiais ativos e o mapa da versão ativa de cada um. */
export async function materiaisDoAcervo(admin: Admin, organizationId: string): Promise<
  Array<MaterialDoAcervo & { versaoAtiva: string | null; status: string | null }>
> {
  const { data: fontes } = await admin
    .from("ai_knowledge_sources")
    .select("id, agent_id, source_type, active_kb_version_id, last_index_status")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .neq("status", "archived")
    .neq("source_type", "conversas");
  const linhas = (fontes ?? []) as Array<{
    id: string;
    agent_id: string | null;
    source_type: string;
    active_kb_version_id: string | null;
    last_index_status: string | null;
  }>;
  const versoes = linhas.map((f) => f.active_kb_version_id).filter((v): v is string => v !== null);
  const mapaPorVersao = new Map<string, string>();
  if (versoes.length > 0) {
    const { data } = await admin
      .from("ai_knowledge_versions")
      .select("id, embedding_model")
      .eq("organization_id", organizationId)
      .in("id", versoes);
    for (const v of (data ?? []) as Array<{ id: string; embedding_model: string | null }>) {
      // Versão anterior à 0181 não gravava o mapa: só existia o legado.
      mapaPorVersao.set(v.id, v.embedding_model ?? MAPA_LEGADO);
    }
  }
  return linhas.map((f) => ({
    id: f.id,
    agent_id: f.agent_id,
    source_type: f.source_type,
    versaoAtiva: f.active_kb_version_id,
    status: f.last_index_status,
    // Material sem versão ativa ainda não está em mapa nenhum.
    mapa: f.active_kb_version_id ? (mapaPorVersao.get(f.active_kb_version_id) ?? MAPA_LEGADO) : "",
  }));
}

/** O que a troca para `mapaAlvo` vai custar e quanto já está nele. */
export async function situacaoDoAcervo(admin: Admin, organizationId: string, mapaAlvo: string): Promise<SituacaoDoAcervo> {
  const materiais = await materiaisDoAcervo(admin, organizationId);
  const comVersao = materiais.filter((m) => m.versaoAtiva !== null);
  const foraDoAlvo = comVersao.filter((m) => m.mapa !== mapaAlvo);

  let trechos = 0;
  let tokens = 0;
  const versoesFora = foraDoAlvo.map((m) => m.versaoAtiva).filter((v): v is string => v !== null);
  if (versoesFora.length > 0) {
    const { data, count } = await admin
      .from("ai_chunks")
      .select("token_count", { count: "exact" })
      .eq("organization_id", organizationId)
      .in("kb_version_id", versoesFora)
      .range(0, TETO_DE_TRECHOS_CONTADOS - 1);
    const lidos = (data ?? []) as Array<{ token_count: number | null }>;
    trechos = count ?? lidos.length;
    const somaLida = lidos.reduce((s, c) => s + (c.token_count ?? 0), 0);
    tokens = lidos.length > 0 ? Math.round((somaLida / lidos.length) * trechos) : 0;
  }

  const preco = precoDoMapa(mapaAlvo);
  return {
    mapaAlvo,
    materiais: comVersao.length,
    noAlvo: comVersao.length - foraDoAlvo.length,
    trechos,
    tokens,
    custoEstimadoCentavos: preco === null ? null : Math.ceil((tokens / 1_000_000) * preco),
    foraDoAlvo: foraDoAlvo.map(({ id, agent_id, source_type, mapa }) => ({ id, agent_id, source_type, mapa })),
  };
}

/**
 * Um evento por material, pelo `event_log`. Devolve quantos foram aceitos —
 * falha de um não impede os outros (o cron reconcilia o que faltar).
 */
export async function pedirReindexacao(
  admin: Admin,
  organizationId: string,
  materiais: readonly MaterialDoAcervo[],
  mapaAlvo: string,
  origem: "troca_no_painel" | "reconciliacao_diaria",
): Promise<number> {
  let aceitos = 0;
  for (const m of materiais) {
    const { error } = await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: m.id,
      p_payload: {
        knowledge_source_id: m.id,
        agent_id: m.agent_id,
        source_type: m.source_type,
        triggered_by: origem,
        motivo: MOTIVO_TROCA_DE_MODELO,
        mapa_alvo: mapaAlvo,
      },
      p_organization_id: organizationId,
    } as never);
    if (!error) aceitos++;
  }
  return aceitos;
}

/**
 * Rede de segurança: reemite a reindexação do que ficou no mapa antigo.
 * Pula o que está indexando agora, o que está sem chave (o indexador já
 * reagenda sozinho) e o que falhou (reemitir todo dia pagaria a mesma falha
 * todo dia — a falha já está avisada na Central).
 */
export async function reconciliarModeloDoAcervo(admin: Admin, organizationId: string): Promise<number> {
  const alvo = await mapaEscolhido(admin, organizationId);
  const materiais = await materiaisDoAcervo(admin, organizationId);
  const pendentes = materiais.filter(
    (m) =>
      m.versaoAtiva !== null &&
      m.mapa !== alvo &&
      m.status !== "indexando" &&
      m.status !== "sem_credencial" &&
      m.status !== "failed",
  );
  if (pendentes.length === 0) return 0;
  return pedirReindexacao(admin, organizationId, pendentes, alvo, "reconciliacao_diaria");
}
