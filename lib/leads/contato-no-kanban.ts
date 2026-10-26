/**
 * O contato numa coluna de um Kanban — o gesto "vincular a uma fase" do inbox.
 *
 * Quem atende escolhe Kanban e coluna; não escolhe "criar negócio" nem "mover
 * negócio". Essa diferença é do sistema: se o contato já tem um negócio ABERTO
 * naquele Kanban, ele vai para a coluna; se não tem, nasce lá. Antes o inbox
 * só sabia criar, e só no Kanban padrão — quem queria mover voltava ao quadro,
 * e quem clicava "Lead" duas vezes ganhava dois cards.
 *
 * Depois de chegar, as tags da coluna vão para o contato (migration 0248), como
 * quando o card é arrastado no quadro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { createLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { aplicarTagDaColuna } from "@/lib/tags/tag-no-kanban";

type SB = SupabaseClient;

export interface KanbanDoContato {
  id: string;
  name: string;
  is_default: boolean;
  stages: Array<{ id: string; name: string; color: string | null; is_won: boolean; is_lost: boolean }>;
}

export interface NegocioDoContato {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
  updated_at: string;
}

/** Os Kanbans ativos da organização (com colunas) e os negócios ABERTOS do contato. */
export async function lerKanbansDoContato(
  supabase: SB,
  organizationId: string,
  contactId: string,
): Promise<{ kanbans: KanbanDoContato[]; negocios: NegocioDoContato[] }> {
  const [{ data: pipes, error: pErr }, { data: stages, error: sErr }, { data: leads, error: lErr }] =
    await Promise.all([
      supabase
        .from("crm_pipelines")
        .select("id, name, is_default, position")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("position"),
      supabase
        .from("crm_stages")
        .select("id, name, color, is_won, is_lost, pipeline_id, position")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("position"),
      supabase
        .from("crm_leads")
        .select("id, title, pipeline_id, stage_id, status, updated_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("status", "open")
        .order("updated_at", { ascending: false }),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (sErr) throw new Error(sErr.message);
  if (lErr) throw new Error(lErr.message);

  const kanbans = ((pipes ?? []) as Array<{ id: string; name: string; is_default: boolean }>).map((p) => ({
    id: p.id,
    name: p.name,
    is_default: p.is_default,
    stages: ((stages ?? []) as Array<KanbanDoContato["stages"][number] & { pipeline_id: string }>)
      .filter((s) => s.pipeline_id === p.id)
      .map(({ id, name, color, is_won, is_lost }) => ({ id, name, color, is_won, is_lost })),
  }));
  return { kanbans, negocios: (leads ?? []) as NegocioDoContato[] };
}

export interface ResultadoNaColuna {
  acao: "criado" | "movido" | "ja_estava";
  lead_id: string;
  pipeline_id: string;
  stage_id: string;
  tags_da_coluna: string[];
}

export async function colocarContatoNaColuna(
  supabase: SB,
  ctx: HandlerCtx,
  input: { contactId: string; stageId: string },
): Promise<ResultadoNaColuna> {
  const { data: stage, error: sErr } = await supabase
    .from("crm_stages")
    .select("id, name, pipeline_id, is_archived")
    .eq("organization_id", ctx.organization_id)
    .eq("id", input.stageId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!stage || stage.is_archived) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Coluna não encontrada.");
  }

  const { data: contato, error: cErr } = await supabase
    .from("contacts")
    .select("id, display_name, name, phone_number, is_anonymized")
    .eq("organization_id", ctx.organization_id)
    .eq("id", input.contactId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!contato) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Contato não encontrado.");
  if (contato.is_anonymized) {
    throw new ApiError(403, "lgpd_anonymization_irreversible", undefined, ctx.requestId, "Contato anonimizado.");
  }

  const { data: abertos, error: lErr } = await supabase
    .from("crm_leads")
    .select("id, stage_id")
    .eq("organization_id", ctx.organization_id)
    .eq("contact_id", input.contactId)
    .eq("pipeline_id", stage.pipeline_id)
    .eq("status", "open")
    .limit(2);
  if (lErr) throw new Error(lErr.message);
  if ((abertos ?? []).length > 1) {
    throw new ApiError(
      409,
      "ambiguous_open_leads",
      undefined,
      ctx.requestId,
      "Este contato tem mais de um negócio aberto neste Kanban. Mova pelo quadro o que você quer.",
    );
  }

  let acao: ResultadoNaColuna["acao"];
  let leadId: string;
  const existente = (abertos ?? [])[0] as { id: string; stage_id: string } | undefined;
  if (existente) {
    leadId = existente.id;
    if (existente.stage_id === stage.id) {
      acao = "ja_estava";
    } else {
      await moveLeadHandler(supabase, ctx, existente.id, { to_stage_id: stage.id });
      acao = "movido";
    }
  } else {
    const nome = (contato.display_name || contato.name || contato.phone_number || "").trim();
    const criado = await createLeadHandler(supabase, ctx, {
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      title: nome.length >= 2 ? nome.slice(0, 200) : "Contato",
      contact_id: input.contactId,
      currency: "BRL",
      tags: [],
      source: "inbox",
    });
    leadId = criado.id as string;
    await emitLeadActivity(supabase, {
      organizationId: ctx.organization_id,
      leadId,
      contactId: input.contactId,
      type: "lead_created",
      sourceModule: "crm",
      sourceId: leadId,
      actor: ctx.actor,
      reason: `Colocado em ${stage.name} pela conversa`,
      payload: { pipeline_id: stage.pipeline_id, stage_id: stage.id },
    });
    acao = "criado";
  }

  const daColuna =
    acao === "ja_estava"
      ? { tagsAcrescentadas: [] as string[] }
      : await aplicarTagDaColuna(supabase, ctx, { leadId, stageId: stage.id });

  return {
    acao,
    lead_id: leadId,
    pipeline_id: stage.pipeline_id,
    stage_id: stage.id,
    tags_da_coluna: daColuna.tagsAcrescentadas,
  };
}
