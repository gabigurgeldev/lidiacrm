/**
 * "Responder e ensinar o agente" — o dono responde uma lacuna do acervo
 * (migration 0245) e a resposta entra no material que TODO agente consulta.
 *
 * ═══ O GATE HUMANO ═══
 *
 * Só entra na base o que alguém da equipe escreveu ou aprovou: a pergunta
 * guardada é a fala do cliente já anonimizada, e quem ensina pode reescrevê-la
 * antes de salvar. Nada aqui gera resposta por modelo.
 *
 * ═══ ONDE A RESPOSTA MORA ═══
 *
 * Num material de perguntas e respostas da organização, "Respostas ensinadas
 * pela equipe", marcado `todos_os_agentes`. A versão publicada de cada agente é
 * imutável; exigir uma republicação por resposta faria o ensino nunca chegar ao
 * agente. O motor soma esse material à lista de cada agente em todo turno
 * (`lib/agent-engine/agent/fontes-da-organizacao.ts`).
 *
 * Responder de novo a mesma lacuna ATUALIZA o par já ensinado, em vez de
 * empilhar duas respostas para a mesma pergunta.
 *
 * `organizationId` vem de fonte confiável (sessão); aqui é service role e o
 * filtro é explícito em toda consulta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarMaterialDeTexto } from "@/lib/ai/rag/criar-material";
import { logger } from "@/lib/logger";

export const NOME_DO_MATERIAL_ENSINADO = "Respostas ensinadas pela equipe";

export type DesfechoDoEnsino =
  | { ok: true; materialId: string; faqItemId: string }
  | { ok: false; motivo: "nao_encontrada" | "falha"; mensagem: string };

async function pedirIndexacao(admin: SupabaseClient, organizationId: string, materialId: string): Promise<void> {
  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: materialId,
    p_payload: { knowledge_source_id: materialId, agent_id: null, source_type: "faq" },
    p_organization_id: organizationId,
  } as never);
  // Não bloqueia: o par está gravado; a indexação pode ser pedida de novo pela tela de materiais.
  if (error) logger.warn("lacuna.emit_falhou", { organizationId, causa: error.message });
}

/** O material "de todos" da organização, se já existir. */
async function materialEnsinado(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await admin
    .from("ai_knowledge_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("todos_os_agentes", true)
    .eq("source_type", "faq")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function ensinarLacuna(
  admin: SupabaseClient,
  input: { organizationId: string; lacunaId: string; userId: string; pergunta: string; resposta: string },
): Promise<DesfechoDoEnsino> {
  const { organizationId, lacunaId } = input;

  const { data: lacuna } = await admin
    .from("knowledge_gaps")
    .select("id, faq_item_id")
    .eq("id", lacunaId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!lacuna) return { ok: false, motivo: "nao_encontrada", mensagem: "Pergunta não encontrada nesta empresa." };
  const faqAnterior = (lacuna as { faq_item_id: string | null }).faq_item_id;

  let materialId = await materialEnsinado(admin, organizationId);
  let faqItemId: string | null = null;

  if (materialId === null) {
    // Primeiro ensino da organização: o material nasce com o par dentro.
    const criado = await criarMaterialDeTexto(admin, organizationId, {
      tipo: "faq",
      nome: NOME_DO_MATERIAL_ENSINADO,
      itens: [{ question: input.pergunta, answer: input.resposta }],
      renomearSeEmUso: true,
      todosOsAgentes: true,
      metadata: { origem: "lacunas" },
    });
    if (!criado.ok) return { ok: false, motivo: "falha", mensagem: criado.mensagem };
    materialId = criado.id;
    const { data: item } = await admin
      .from("ai_faq_items")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("knowledge_source_id", materialId)
      .limit(1)
      .maybeSingle();
    faqItemId = (item as { id: string } | null)?.id ?? null;
  } else {
    // Já ensinada antes e o par ainda existe: atualiza no lugar.
    if (faqAnterior !== null) {
      const { data: atualizado } = await admin
        .from("ai_faq_items")
        .update({ question: input.pergunta, answer: input.resposta, updated_at: new Date().toISOString() })
        .eq("id", faqAnterior)
        .eq("organization_id", organizationId)
        .select("id")
        .maybeSingle();
      faqItemId = (atualizado as { id: string } | null)?.id ?? null;
    }
    if (faqItemId === null) {
      const { data: ultimo } = await admin
        .from("ai_faq_items")
        .select("position")
        .eq("organization_id", organizationId)
        .eq("knowledge_source_id", materialId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const posicao = ((ultimo as { position: number } | null)?.position ?? -1) + 1;
      const { data: novo, error } = await admin
        .from("ai_faq_items")
        .insert({
          organization_id: organizationId,
          knowledge_source_id: materialId,
          question: input.pergunta,
          answer: input.resposta,
          tags: [],
          locale: "pt-BR",
          position: posicao,
        })
        .select("id")
        .single();
      if (error || !novo) {
        logger.error("lacuna.par_nao_gravado", { organizationId, causa: error?.message ?? "sem id" });
        return { ok: false, motivo: "falha", mensagem: "Erro ao gravar a resposta." };
      }
      faqItemId = (novo as { id: string }).id;
    }
    await pedirIndexacao(admin, organizationId, materialId);
  }

  if (faqItemId === null) {
    logger.error("lacuna.par_sem_id", { organizationId });
    return { ok: false, motivo: "falha", mensagem: "Erro ao gravar a resposta." };
  }

  await admin
    .from("knowledge_gaps")
    .update({
      status: "respondida",
      faq_item_id: faqItemId,
      respondida_por: input.userId,
      respondida_em: new Date().toISOString(),
    })
    .eq("id", lacunaId)
    .eq("organization_id", organizationId);
  await fecharAvisos(admin, organizationId, lacunaId);

  return { ok: true, materialId, faqItemId };
}

/** "Não é pergunta para o material": a lacuna para de gerar aviso. */
export async function descartarLacuna(
  admin: SupabaseClient,
  input: { organizationId: string; lacunaId: string },
): Promise<{ ok: boolean }> {
  const { data } = await admin
    .from("knowledge_gaps")
    .update({ status: "descartada" })
    .eq("id", input.lacunaId)
    .eq("organization_id", input.organizationId)
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false };
  await fecharAvisos(admin, input.organizationId, input.lacunaId);
  return { ok: true };
}

async function fecharAvisos(admin: SupabaseClient, organizationId: string, lacunaId: string): Promise<void> {
  await admin
    .from("agent_inbox_items")
    .update({ status: "resolved" })
    .eq("organization_id", organizationId)
    .eq("kind", "knowledge_gap")
    .eq("ref_kind", "knowledge_gap")
    .eq("ref_id", lacunaId)
    .eq("status", "open");
}
