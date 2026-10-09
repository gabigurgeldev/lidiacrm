/**
 * Grava um material de conhecimento de TEXTO (FAQ ou documento colado) e pede a
 * indexação. Uma implementação, dois chamadores:
 *
 *   - `POST /api/v1/ai/knowledge/sources` (a tela de materiais e a API);
 *   - "Criar agente com IA" (`lib/ai/agents/construtor/criar.ts`).
 *
 * Antes isto vivia inline na rota, e o construtor teria de copiá-lo — duas
 * cópias de "texto colado vira .md no bucket" divergiriam no primeiro conserto.
 *
 * Quem chama já validou o conteúdo e resolveu `organizationId` de fonte
 * confiável (sessão); aqui é service role e o filtro é explícito.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { BUCKET_DE_CONHECIMENTO } from "@/lib/ai/rag/ingest/documento";
import { logger } from "@/lib/logger";

export interface ItemDeFaq {
  question: string;
  answer: string;
  tags?: string[];
  locale?: string;
}

export interface NovoMaterialDeTexto {
  tipo: "faq" | "documento";
  nome: string;
  /** Obrigatório (e não vazio) quando `tipo === "faq"`. */
  itens?: ItemDeFaq[];
  /** Obrigatório (e não vazio) quando `tipo === "documento"`. */
  texto?: string;
  /**
   * O `source_type` gravado, quando não é o próprio `tipo`. A rota de materiais
   * também cria fontes que se preenchem sozinhas (`conversas`, `catalogo`), sem
   * conteúdo colado; elas entram como `tipo: "faq"` sem itens e com o tipo real
   * aqui.
   */
  sourceType?: string;
  /** Registro histórico de onde o material nasceu (0181). */
  agentId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Nome já em uso por outro material ativo: `true` tenta "Nome (2)", "(3)"…
   * em vez de recusar. A tela de materiais NÃO usa — lá a pessoa escolheu o
   * nome e precisa saber que ele colide.
   */
  renomearSeEmUso?: boolean;
}

export type MaterialCriado =
  | { ok: true; id: string; nome: string; itemsCount: number }
  | { ok: false; motivo: "nome_em_uso" | "falha"; mensagem: string };

const TENTATIVAS_DE_NOME = 5;

export async function criarMaterialDeTexto(
  admin: SupabaseClient,
  organizationId: string,
  m: NovoMaterialDeTexto,
): Promise<MaterialCriado> {
  // TEXTO COLADO DE DOCUMENTO VIRA ARQUIVO: o indexador lê documento do
  // bucket, pela mesma rota de extração dos arquivos enviados. Um destino, um
  // caminho, um lugar para consertar.
  let metadata: Record<string, unknown> = { ...(m.metadata ?? {}) };
  let blobPath: string | null = null;
  if (m.tipo === "documento" && m.texto) {
    blobPath = `${organizationId}/${randomUUID()}.md`;
    const { error: upErr } = await admin.storage
      .from(BUCKET_DE_CONHECIMENTO)
      .upload(blobPath, Buffer.from(m.texto, "utf8"), { contentType: "text/markdown", upsert: false });
    if (upErr) {
      logger.error("knowledge_source.texto_nao_guardado", { organizationId, causa: upErr.message });
      return { ok: false, motivo: "falha", mensagem: "Erro ao guardar o conteúdo do material." };
    }
    metadata = { ...metadata, blob_path: blobPath, ext: "md", origem: "texto_colado" };
  }

  let id: string | null = null;
  let nome = m.nome;
  const tentativas = m.renomearSeEmUso ? TENTATIVAS_DE_NOME : 1;
  for (let i = 0; i < tentativas && id === null; i++) {
    nome = i === 0 ? m.nome : `${m.nome.slice(0, 110)} (${i + 1})`;
    const { data, error } = await admin
      .from("ai_knowledge_sources")
      .insert({
        organization_id: organizationId,
        agent_id: m.agentId ?? null,
        source_type: m.sourceType ?? m.tipo,
        name: nome,
        status: "ready",
        is_active: true,
        source_metadata: metadata,
        ingested_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (data) {
      id = (data as { id: string }).id;
      break;
    }
    // `ai_knowledge_sources_nome_unico_por_org`.
    if (error?.code === "23505") continue;
    logger.error("knowledge_source.insert_falhou", { organizationId, causa: error?.message ?? "sem id" });
    return { ok: false, motivo: "falha", mensagem: "Erro ao criar o material." };
  }
  if (id === null) {
    return { ok: false, motivo: "nome_em_uso", mensagem: `Já existe um material chamado "${m.nome}". Escolha outro nome.` };
  }

  let itemsCount = 0;
  const itens = m.tipo === "faq" ? (m.itens ?? []) : [];
  if (itens.length > 0) {
    const rows = itens.map((item, idx) => ({
      organization_id: organizationId,
      knowledge_source_id: id,
      question: item.question,
      answer: item.answer,
      tags: item.tags ?? [],
      locale: item.locale ?? "pt-BR",
      position: idx,
    }));
    const { error: itemsErr } = await admin.from("ai_faq_items").insert(rows);
    if (itemsErr) {
      // Fonte sem item nenhum é fonte vazia: melhor desfazer do que deixar uma
      // linha que promete conteúdo e nunca vai indexar nada.
      await admin.from("ai_knowledge_sources").delete().eq("id", id).eq("organization_id", organizationId);
      logger.error("knowledge_source.itens_falharam", { organizationId, causa: itemsErr.message });
      return { ok: false, motivo: "falha", mensagem: "Erro ao gravar o conteúdo do material." };
    }
    itemsCount = rows.length;
  }

  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: id,
    p_payload: { knowledge_source_id: id, agent_id: m.agentId ?? null, source_type: m.sourceType ?? m.tipo },
    p_organization_id: organizationId,
  } as never);
  if (emitErr) {
    // Não bloqueia: o material existe; a indexação pode ser pedida de novo pela tela.
    logger.warn("knowledge_source.emit_falhou", { organizationId, causa: emitErr.message });
  }

  return { ok: true, id, nome, itemsCount };
}
