/**
 * Tag ↔ coluna do Kanban — os dois sentidos da sincronia (migration 0248).
 *
 * 1. `aplicarTagsNoKanban`: o contato GANHOU tags. Para cada tag vinculada a uma
 *    coluna (`crm_stage_tags`), o negócio aberto do contato naquele Kanban vai
 *    para a coluna — ou nasce nela, se o contato ainda não tem negócio ali.
 * 2. `aplicarTagDaColuna`: um negócio ENTROU numa coluna. As tags vinculadas a
 *    ela são acrescentadas ao contato, e só então a regra 1 roda para os OUTROS
 *    Kanbans onde essas tags apontam (um salto só — ver abaixo).
 *
 * Nenhum dos dois remove tag (decisão do produto, 2026-10-26): sair da coluna
 * não tira a tag, tirar a tag não tira o card. Remoção automática faria o
 * operador perder uma marcação que pôs à mão só por arrastar um card.
 *
 * Por que não pelo `event_log`: quem aplica a tag no inbox precisa ver o card
 * mudar NA HORA ("Contato movido para Vendas › Proposta"), e o dreno do
 * barramento roda por minuto. A regra mora aqui, chamada no mesmo request por
 * todo caminho que acrescenta tag a contato ou move negócio — e o evento
 * `contact.tag_added` continua sendo emitido para as automações de sempre.
 *
 * Nunca derruba quem chamou: a tag JÁ foi gravada (ou o card JÁ moveu). Falha
 * vira efeito `falhou` no retorno, que a tela mostra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { createLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { normalizarTags } from "@/lib/tags/normalizar";

type SB = SupabaseClient;

export type AcaoNoKanban = "criado" | "movido" | "ja_estava" | "ambiguo" | "falhou";

export interface EfeitoNoKanban {
  tag: string;
  pipeline_id: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
  lead_id: string | null;
  acao: AcaoNoKanban;
}

interface Vinculo {
  tag: string;
  pipeline_id: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
}

/**
 * As colunas para onde as tags apontam, uma por Kanban. Se duas tags do mesmo
 * lote apontam para colunas diferentes do MESMO Kanban, vale a última da lista
 * — é a mais recente na ordem em que a pessoa aplicou.
 */
export async function vinculosDasTags(
  supabase: SB,
  organizationId: string,
  tags: readonly string[],
): Promise<Vinculo[]> {
  const nomes = normalizarTags(tags);
  if (nomes.length === 0) return [];

  const { data: catalogo, error: catErr } = await supabase
    .from("crm_tags")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("is_archived", false)
    .in("name", nomes);
  if (catErr) throw new Error(catErr.message);
  const nomePorId = new Map((catalogo ?? []).map((t) => [t.id as string, t.name as string]));
  if (nomePorId.size === 0) return [];

  const { data: links, error: linkErr } = await supabase
    .from("crm_stage_tags")
    .select("tag_id, pipeline_id, stage_id")
    .eq("organization_id", organizationId)
    .in("tag_id", [...nomePorId.keys()]);
  if (linkErr) throw new Error(linkErr.message);
  if (!links || links.length === 0) return [];

  const stageIds = [...new Set(links.map((l) => l.stage_id as string))];
  const pipelineIds = [...new Set(links.map((l) => l.pipeline_id as string))];
  const [{ data: stages, error: sErr }, { data: pipelines, error: pErr }] = await Promise.all([
    supabase
      .from("crm_stages")
      .select("id, name, is_archived")
      .eq("organization_id", organizationId)
      .in("id", stageIds),
    supabase
      .from("crm_pipelines")
      .select("id, name, is_archived")
      .eq("organization_id", organizationId)
      .in("id", pipelineIds),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (pErr) throw new Error(pErr.message);

  const stagePorId = new Map((stages ?? []).map((s) => [s.id as string, s]));
  const pipelinePorId = new Map((pipelines ?? []).map((p) => [p.id as string, p]));

  const ordem = new Map(nomes.map((n, i) => [n, i]));
  const porKanban = new Map<string, Vinculo & { ordem: number }>();
  for (const l of links) {
    const tag = nomePorId.get(l.tag_id as string);
    const stage = stagePorId.get(l.stage_id as string);
    const pipeline = pipelinePorId.get(l.pipeline_id as string);
    if (!tag || !stage || !pipeline || stage.is_archived || pipeline.is_archived) continue;
    const v = {
      tag,
      pipeline_id: pipeline.id as string,
      pipeline_name: pipeline.name as string,
      stage_id: stage.id as string,
      stage_name: stage.name as string,
      ordem: ordem.get(tag) ?? 0,
    };
    const atual = porKanban.get(v.pipeline_id);
    if (!atual || v.ordem >= atual.ordem) porKanban.set(v.pipeline_id, v);
  }

  return [...porKanban.values()]
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ ordem: _o, ...v }) => v);
}

interface LeadAberto {
  id: string;
  pipeline_id: string;
  stage_id: string;
}

function tituloDoContato(c: {
  display_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
}): string {
  const t = (c.display_name || c.name || c.phone_number || "").trim();
  return t.length >= 2 ? t.slice(0, 200) : "Contato";
}

export async function aplicarTagsNoKanban(
  supabase: SB,
  ctx: HandlerCtx,
  input: {
    contactId: string;
    tagsAdicionadas: readonly string[];
    /** Kanbans que este salto não deve tocar (o de onde a tag veio). */
    excetoPipelines?: readonly string[];
  },
): Promise<EfeitoNoKanban[]> {
  let vinculos: Vinculo[];
  try {
    vinculos = await vinculosDasTags(supabase, ctx.organization_id, input.tagsAdicionadas);
  } catch (err) {
    console.error("[tag-no-kanban] leitura dos vínculos falhou", (err as Error).message);
    return [];
  }
  const excetos = new Set(input.excetoPipelines ?? []);
  vinculos = vinculos.filter((v) => !excetos.has(v.pipeline_id));
  if (vinculos.length === 0) return [];

  const { data: contato } = await supabase
    .from("contacts")
    .select("id, display_name, name, phone_number, is_anonymized")
    .eq("organization_id", ctx.organization_id)
    .eq("id", input.contactId)
    .maybeSingle();
  if (!contato || contato.is_anonymized) return [];

  const { data: abertos } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id")
    .eq("organization_id", ctx.organization_id)
    .eq("contact_id", input.contactId)
    .eq("status", "open")
    .in(
      "pipeline_id",
      vinculos.map((v) => v.pipeline_id),
    );
  const leadsPorKanban = new Map<string, LeadAberto[]>();
  for (const l of (abertos ?? []) as LeadAberto[]) {
    leadsPorKanban.set(l.pipeline_id, [...(leadsPorKanban.get(l.pipeline_id) ?? []), l]);
  }

  const efeitos: EfeitoNoKanban[] = [];
  for (const v of vinculos) {
    const base = { ...v };
    const doKanban = leadsPorKanban.get(v.pipeline_id) ?? [];
    try {
      if (doKanban.length > 1) {
        // Dois negócios abertos do mesmo contato no mesmo Kanban: mover um deles
        // seria adivinhar qual — e mover o card errado é dano visível. A tela
        // avisa e a pessoa escolhe.
        efeitos.push({ ...base, lead_id: null, acao: "ambiguo" });
        continue;
      }
      const lead = doKanban[0];
      if (lead) {
        if (lead.stage_id === v.stage_id) {
          efeitos.push({ ...base, lead_id: lead.id, acao: "ja_estava" });
          continue;
        }
        await moveLeadHandler(supabase, ctx, lead.id, {
          to_stage_id: v.stage_id,
          reason: `pela tag "${v.tag}"`,
        });
        efeitos.push({ ...base, lead_id: lead.id, acao: "movido" });
        continue;
      }

      const criado = await createLeadHandler(supabase, ctx, {
        pipeline_id: v.pipeline_id,
        stage_id: v.stage_id,
        title: tituloDoContato(contato),
        contact_id: input.contactId,
        currency: "BRL",
        tags: [],
        source: "tag",
      });
      const leadId = criado.id as string;
      await emitLeadActivity(supabase, {
        organizationId: ctx.organization_id,
        leadId,
        contactId: input.contactId,
        type: "lead_created",
        sourceModule: "crm",
        sourceId: leadId,
        actor: ctx.actor,
        reason: `Entrou em ${v.stage_name} pela tag "${v.tag}"`,
        payload: { pipeline_id: v.pipeline_id, stage_id: v.stage_id, tag: v.tag },
      });
      efeitos.push({ ...base, lead_id: leadId, acao: "criado" });
    } catch (err) {
      const msg = err instanceof ApiError ? err.code : (err as Error).message;
      console.error("[tag-no-kanban] efeito falhou", v.pipeline_id, msg);
      efeitos.push({ ...base, lead_id: lead_idOuNulo(doKanban), acao: "falhou" });
    }
  }
  return efeitos;
}

function lead_idOuNulo(l: LeadAberto[]): string | null {
  return l.length === 1 ? l[0]!.id : null;
}

/**
 * O negócio entrou na coluna `stageId`: as tags da coluna vão para o contato.
 * Devolve as tags acrescentadas e os efeitos nos OUTROS Kanbans.
 *
 * Um salto só: os Kanbans tocados aqui não reaplicam as tags das colunas onde o
 * negócio deles caiu. Sem esse limite, duas colunas que apontam uma para a
 * outra por tags diferentes formariam uma corrente que a pessoa não pediu.
 */
export async function aplicarTagDaColuna(
  supabase: SB,
  ctx: HandlerCtx,
  input: { leadId: string; stageId: string },
): Promise<{ tagsAcrescentadas: string[]; efeitos: EfeitoNoKanban[] }> {
  const nada = { tagsAcrescentadas: [], efeitos: [] };
  try {
    const { data: links } = await supabase
      .from("crm_stage_tags")
      .select("tag_id, pipeline_id")
      .eq("organization_id", ctx.organization_id)
      .eq("stage_id", input.stageId);
    if (!links || links.length === 0) return nada;

    const { data: tags } = await supabase
      .from("crm_tags")
      .select("name")
      .eq("organization_id", ctx.organization_id)
      .eq("is_archived", false)
      .in(
        "id",
        links.map((l) => l.tag_id as string),
      );
    const nomes = (tags ?? []).map((t) => t.name as string);
    if (nomes.length === 0) return nada;

    const { data: lead } = await supabase
      .from("crm_leads")
      .select("contact_id, pipeline_id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", input.leadId)
      .maybeSingle();
    const contactId = lead?.contact_id as string | null | undefined;
    if (!contactId) return nada;

    const { data: contato } = await supabase
      .from("contacts")
      .select("tags, is_anonymized")
      .eq("organization_id", ctx.organization_id)
      .eq("id", contactId)
      .maybeSingle();
    if (!contato || contato.is_anonymized) return nada;

    const atuais = (contato.tags ?? []) as string[];
    const novas = nomes.filter((n) => !atuais.includes(n));
    if (novas.length === 0) return nada;

    const { error: updErr } = await supabase
      .from("contacts")
      .update({ tags: [...atuais, ...novas], updated_at: new Date().toISOString() })
      .eq("organization_id", ctx.organization_id)
      .eq("id", contactId);
    if (updErr) throw new Error(updErr.message);

    await supabase
      .rpc("emit_event", {
        p_event_type: "contact.tag_added",
        p_entity_kind: "contact",
        p_entity_id: contactId,
        p_payload: { added_tags: novas, tags: [...atuais, ...novas], via: "kanban_column" },
        p_metadata: { request_id: ctx.requestId, stage_id: input.stageId },
        p_organization_id: ctx.organization_id,
      })
      .then(({ error }) => {
        if (error) console.error("[tag-no-kanban] emit_event falhou", error.message);
      });

    const efeitos = await aplicarTagsNoKanban(supabase, ctx, {
      contactId,
      tagsAdicionadas: novas,
      excetoPipelines: [lead!.pipeline_id as string],
    });
    return { tagsAcrescentadas: novas, efeitos };
  } catch (err) {
    console.error("[tag-no-kanban] tag da coluna falhou", (err as Error).message);
    return nada;
  }
}
