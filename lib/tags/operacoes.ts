/**
 * Operações do catálogo de tags (migration 0248). A regra vive aqui, lança
 * `ApiError` e não conhece HTTP; as rotas de `app/api/v1/tags` só traduzem
 * (mesma divisão de `lib/leads/stage-operations.ts`).
 *
 * `organizationId` NUNCA vem do corpo: o chamador o resolve da sessão.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { nomeDeTagValido, normalizarTag } from "@/lib/tags/normalizar";
import type { ColunaDaTag, TagDoCatalogo } from "@/lib/tags/tipos";

export type { ColunaDaTag, TagDoCatalogo };

type SB = SupabaseClient;

export interface DepsDeTag {
  supabase: SB;
  organizationId: string;
  userId: string;
  requestId: string;
}

const COLUNAS = "id, name, color, description, is_archived, created_at";

function erro(status: number, code: string, requestId: string, mensagem: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(status, code, details, requestId, mensagem);
}

/** O catálogo da organização, com as colunas de Kanban vinculadas a cada tag. */
export async function listarTags(
  supabase: SB,
  organizationId: string,
  opts: { comUso?: boolean; incluirArquivadas?: boolean } = {},
): Promise<TagDoCatalogo[]> {
  let q = supabase
    .from("crm_tags")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (!opts.incluirArquivadas) q = q.eq("is_archived", false);

  const [{ data: tags, error }, { data: links, error: linkErr }] = await Promise.all([
    q,
    supabase
      .from("crm_stage_tags")
      .select("tag_id, pipeline_id, stage_id")
      .eq("organization_id", organizationId),
  ]);
  if (error) throw new Error(error.message);
  if (linkErr) throw new Error(linkErr.message);

  const colunasPorTag = new Map<string, ColunaDaTag[]>();
  if (links && links.length > 0) {
    const [{ data: stages }, { data: pipelines }] = await Promise.all([
      supabase
        .from("crm_stages")
        .select("id, name, is_archived")
        .eq("organization_id", organizationId)
        .in("id", [...new Set(links.map((l) => l.stage_id as string))]),
      supabase
        .from("crm_pipelines")
        .select("id, name, is_archived")
        .eq("organization_id", organizationId)
        .in("id", [...new Set(links.map((l) => l.pipeline_id as string))]),
    ]);
    const stagePorId = new Map((stages ?? []).map((s) => [s.id as string, s]));
    const pipelinePorId = new Map((pipelines ?? []).map((p) => [p.id as string, p]));
    for (const l of links) {
      const s = stagePorId.get(l.stage_id as string);
      const p = pipelinePorId.get(l.pipeline_id as string);
      if (!s || !p || s.is_archived || p.is_archived) continue;
      const lista = colunasPorTag.get(l.tag_id as string) ?? [];
      lista.push({
        pipeline_id: p.id as string,
        pipeline_name: p.name as string,
        stage_id: s.id as string,
        stage_name: s.name as string,
      });
      colunasPorTag.set(l.tag_id as string, lista);
    }
  }

  const saida: TagDoCatalogo[] = ((tags ?? []) as Omit<TagDoCatalogo, "colunas">[]).map((t) => ({
    ...t,
    colunas: colunasPorTag.get(t.id) ?? [],
  }));

  if (opts.comUso && saida.length > 0) {
    const contagens = await Promise.all(
      saida.map((t) =>
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .contains("tags", [t.name]),
      ),
    );
    contagens.forEach((r, i) => {
      saida[i]!.uso = r.count ?? 0;
    });
  }
  return saida;
}

const COR = /^#[0-9a-f]{6}$/;

function corValida(cor: string | undefined, requestId: string): string | undefined {
  if (cor === undefined) return undefined;
  const c = cor.toLowerCase();
  if (!COR.test(c)) throw erro(422, "unprocessable_entity", requestId, "Cor inválida. Use #rrggbb.");
  return c;
}

/** Outra tag da organização com o mesmo nome ignorando a caixa. */
async function homonima(supabase: SB, organizationId: string, nome: string, excetoId: string | null) {
  const { data, error } = await supabase
    .from("crm_tags")
    .select("id, name, is_archived")
    .eq("organization_id", organizationId)
    .ilike("name", nome.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; is_archived: boolean }>).find(
    (t) => t.id !== excetoId,
  );
}

export async function criarTag(
  deps: DepsDeTag,
  input: { name: string; color?: string; description?: string | null },
): Promise<TagDoCatalogo> {
  const { supabase, organizationId, requestId } = deps;
  const nome = normalizarTag(input.name);
  if (!nomeDeTagValido(nome)) {
    throw erro(422, "unprocessable_entity", requestId, "O nome da tag precisa ter de 1 a 40 caracteres.");
  }
  const cor = corValida(input.color, requestId);

  const igual = await homonima(supabase, organizationId, nome, null);
  if (igual) {
    throw erro(
      409,
      "tag_already_exists",
      requestId,
      igual.is_archived
        ? `Já existe a tag "${igual.name}", arquivada. Reative-a em vez de criar outra.`
        : `Já existe a tag "${igual.name}".`,
      { tag_id: igual.id },
    );
  }

  const { data, error } = await supabase
    .from("crm_tags")
    .insert({
      organization_id: organizationId,
      name: nome,
      ...(cor ? { color: cor } : {}),
      description: input.description?.trim() || null,
      created_by_user_id: deps.userId,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw erro(409, "tag_already_exists", requestId, `Já existe a tag "${nome}".`);
    }
    throw new Error(error.message);
  }

  await audit({
    action: "tag.created",
    actorUserId: deps.userId,
    organizationId,
    resourceType: "crm_tag",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { name: nome, color: (data as { color: string }).color },
  });
  return { ...(data as Omit<TagDoCatalogo, "colunas">), colunas: [] };
}

/**
 * Edita uma tag. Renomear passa por `fn_renomear_tag` (definer, `service_role`),
 * que propaga o nome para os arrays de contato, lead e conversa — por isso o
 * `admin`. Renomear para o nome de OUTRA tag funde as duas (a de destino
 * fica); a tela pergunta antes, e o corpo confirma com `fundir: true`.
 */
export async function atualizarTag(
  deps: DepsDeTag & { admin: SB },
  tagId: string,
  input: {
    name?: string;
    color?: string;
    description?: string | null;
    is_archived?: boolean;
    fundir?: boolean;
  },
): Promise<{ id: string; fundida_em?: string }> {
  const { supabase, admin, organizationId, requestId } = deps;
  const { data: atual, error } = await supabase
    .from("crm_tags")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("id", tagId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!atual) throw erro(404, "not_found", requestId, "Tag não encontrada.");

  const campos: string[] = [];
  let idFinal = tagId;
  let fundidaEm: string | undefined;
  const meta: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const nome = normalizarTag(input.name);
    if (!nomeDeTagValido(nome)) {
      throw erro(422, "unprocessable_entity", requestId, "O nome da tag precisa ter de 1 a 40 caracteres.");
    }
    if (nome !== atual.name) {
      const igual = await homonima(supabase, organizationId, nome, tagId);
      if (igual && igual.name !== nome) {
        // Mesmo nome com outra caixa: fundir exigiria escolher a grafia. Peça o nome exato.
        throw erro(409, "tag_already_exists", requestId, `Já existe a tag "${igual.name}". Use exatamente esse nome para juntar as duas.`, {
          tag_id: igual.id,
        });
      }
      if (igual && !input.fundir) {
        throw erro(409, "tag_merge_required", requestId, `Já existe a tag "${igual.name}". Confirme para juntar as duas.`, {
          tag_id: igual.id,
        });
      }
      const { data: destino, error: rpcErr } = await admin.rpc("fn_renomear_tag", {
        p_organization_id: organizationId,
        p_tag_id: tagId,
        p_novo_nome: nome,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      idFinal = destino as string;
      if (idFinal !== tagId) fundidaEm = idFinal;
      campos.push("name");
      meta.old_name = atual.name;
      meta.new_name = nome;
    }
  }

  const patch: Record<string, unknown> = {};
  const cor = corValida(input.color, requestId);
  if (cor !== undefined && cor !== atual.color) patch.color = cor;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.is_archived !== undefined && input.is_archived !== atual.is_archived) {
    patch.is_archived = input.is_archived;
  }
  if (Object.keys(patch).length > 0 && !fundidaEm) {
    const { error: updErr } = await supabase
      .from("crm_tags")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", idFinal);
    if (updErr) throw new Error(updErr.message);
    campos.push(...Object.keys(patch));
  }

  if (campos.length > 0) {
    await audit({
      action: patch.is_archived === true ? "tag.archived" : "tag.updated",
      actorUserId: deps.userId,
      organizationId,
      resourceType: "crm_tag",
      resourceId: tagId,
      requestId,
      metadata: { campos, ...meta, ...(fundidaEm ? { fundida_em: fundidaEm } : {}) },
    });
  }
  return fundidaEm ? { id: idFinal, fundida_em: fundidaEm } : { id: idFinal };
}

/**
 * Define as tags de uma coluna (substitui o conjunto). Uma tag só pode estar em
 * UMA coluna por Kanban: vinculada a outra, a resposta é 409 com a coluna que
 * já a tem — a tela pergunta se é para trocar e reenvia com `mover: true`.
 */
export async function definirTagsDaColuna(
  deps: DepsDeTag,
  pipelineId: string,
  stageId: string,
  input: { tag_ids: string[]; mover?: boolean },
): Promise<{ tag_ids: string[] }> {
  const { supabase, organizationId, requestId } = deps;
  const tagIds = [...new Set(input.tag_ids)];

  const { data: stage, error: sErr } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, name, is_archived")
    .eq("organization_id", organizationId)
    .eq("id", stageId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!stage || stage.pipeline_id !== pipelineId) {
    throw erro(404, "not_found", requestId, "Coluna não encontrada.");
  }

  if (tagIds.length > 0) {
    const { data: tags, error: tErr } = await supabase
      .from("crm_tags")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", tagIds);
    if (tErr) throw new Error(tErr.message);
    if ((tags ?? []).length !== tagIds.length) {
      throw erro(404, "not_found", requestId, "Alguma das tags não existe.");
    }

    const { data: emOutra, error: oErr } = await supabase
      .from("crm_stage_tags")
      .select("tag_id, stage_id")
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipelineId)
      .neq("stage_id", stageId)
      .in("tag_id", tagIds);
    if (oErr) throw new Error(oErr.message);
    if ((emOutra ?? []).length > 0) {
      if (!input.mover) {
        throw erro(
          409,
          "tag_already_linked_in_pipeline",
          requestId,
          "Uma tag escolhida já está em outra coluna deste Kanban.",
          { conflitos: emOutra },
        );
      }
      const { error: delOutra } = await supabase
        .from("crm_stage_tags")
        .delete()
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipelineId)
        .neq("stage_id", stageId)
        .in("tag_id", tagIds);
      if (delOutra) throw new Error(delOutra.message);
    }
  }

  const { data: atuais, error: aErr } = await supabase
    .from("crm_stage_tags")
    .select("tag_id")
    .eq("organization_id", organizationId)
    .eq("stage_id", stageId);
  if (aErr) throw new Error(aErr.message);
  const atuaisIds = new Set((atuais ?? []).map((a) => a.tag_id as string));
  const sair = [...atuaisIds].filter((id) => !tagIds.includes(id));
  const entrar = tagIds.filter((id) => !atuaisIds.has(id));

  if (sair.length > 0) {
    const { error } = await supabase
      .from("crm_stage_tags")
      .delete()
      .eq("organization_id", organizationId)
      .eq("stage_id", stageId)
      .in("tag_id", sair);
    if (error) throw new Error(error.message);
  }
  if (entrar.length > 0) {
    const { error } = await supabase.from("crm_stage_tags").insert(
      entrar.map((tag_id) => ({
        organization_id: organizationId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        tag_id,
      })),
    );
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw erro(409, "tag_already_linked_in_pipeline", requestId, "Uma tag escolhida já está em outra coluna deste Kanban.");
      }
      throw new Error(error.message);
    }
  }

  if (sair.length > 0 || entrar.length > 0) {
    await audit({
      action: "stage.tags_changed",
      actorUserId: deps.userId,
      organizationId,
      resourceType: "crm_stage",
      resourceId: stageId,
      requestId,
      metadata: { pipeline_id: pipelineId, tag_ids: tagIds, entraram: entrar, sairam: sair },
    });
  }
  return { tag_ids: tagIds };
}

/**
 * As colunas de UMA tag, vistas da tag (a página de Tags): no máximo uma por
 * Kanban. Substitui o conjunto — o que não vier deixa de estar vinculado.
 * Outras tags da mesma coluna não são tocadas.
 */
export async function definirColunasDaTag(
  deps: DepsDeTag,
  tagId: string,
  input: { stage_ids: string[] },
): Promise<{ stage_ids: string[] }> {
  const { supabase, organizationId, requestId } = deps;
  const stageIds = [...new Set(input.stage_ids)];

  const { data: tag, error: tErr } = await supabase
    .from("crm_tags")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", tagId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!tag) throw erro(404, "not_found", requestId, "Tag não encontrada.");

  let colunas: Array<{ id: string; pipeline_id: string }> = [];
  if (stageIds.length > 0) {
    const { data, error } = await supabase
      .from("crm_stages")
      .select("id, pipeline_id, is_archived")
      .eq("organization_id", organizationId)
      .in("id", stageIds);
    if (error) throw new Error(error.message);
    const vivas = ((data ?? []) as Array<{ id: string; pipeline_id: string; is_archived: boolean }>).filter(
      (s) => !s.is_archived,
    );
    if (vivas.length !== stageIds.length) {
      throw erro(404, "not_found", requestId, "Alguma das colunas não existe.");
    }
    const porKanban = new Set<string>();
    for (const s of vivas) {
      if (porKanban.has(s.pipeline_id)) {
        throw erro(422, "one_column_per_pipeline", requestId, "Escolha uma coluna só em cada Kanban.");
      }
      porKanban.add(s.pipeline_id);
    }
    colunas = vivas;
  }

  const { error: delErr } = await supabase
    .from("crm_stage_tags")
    .delete()
    .eq("organization_id", organizationId)
    .eq("tag_id", tagId);
  if (delErr) throw new Error(delErr.message);

  if (colunas.length > 0) {
    const { error: insErr } = await supabase.from("crm_stage_tags").insert(
      colunas.map((c) => ({
        organization_id: organizationId,
        pipeline_id: c.pipeline_id,
        stage_id: c.id,
        tag_id: tagId,
      })),
    );
    if (insErr) throw new Error(insErr.message);
  }

  await audit({
    action: "stage.tags_changed",
    actorUserId: deps.userId,
    organizationId,
    resourceType: "crm_tag",
    resourceId: tagId,
    requestId,
    metadata: { stage_ids: stageIds },
  });
  return { stage_ids: stageIds };
}
