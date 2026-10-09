/**
 * O que a tela do coordenador lê e escreve — servidor, cliente admin.
 *
 * A organização vem SEMPRE de quem chama (sessão resolvida pela rota/página),
 * e toda consulta filtra por ela: o cliente admin passa por cima da RLS.
 *
 * A tela edita a política da ORGANIZAÇÃO. Um número com política própria
 * aparece como tal (somente leitura nesta versão), porque a política do número
 * substitui a da organização INTEIRA — e editar duas políticas na mesma tela
 * é o caminho mais curto para alguém achar que mudou uma e ter mudado a outra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MOTIVOS, rotuloDoMotivo } from "./motivos";
import type { PoliticaEfetiva } from "./politica/resolver";
import { politicaSchema, type ModoDoCoordenador, type Politica } from "./politica/schema";

export interface AgenteDisponivel {
  id: string;
  nome: string;
  /** Tem versão publicada: só assim recebe conversa. */
  publicado: boolean;
}

export interface FluxoDisponivel {
  id: string;
  nome: string;
  ativo: boolean;
  /** Fala com o cliente (mensagem, pergunta, menu). */
  interativo: boolean;
}

export interface VersaoPublicada {
  versao_id: string;
  numero: number;
  modo: ModoDoCoordenador;
  publicado_em: string;
  channel_session_id: string | null;
}

export interface Painel {
  /** A política da organização em vigor (ou a inicial, desligada). */
  politica: Politica;
  versaoAtual: VersaoPublicada | null;
  historico: VersaoPublicada[];
  /** Números que seguem política própria (não editável aqui). */
  numerosComPoliticaPropria: { channel_session_id: string; modo: ModoDoCoordenador; numero: number }[];
  agentes: AgenteDisponivel[];
  fluxos: FluxoDisponivel[];
  resumo24h: { aplicadas: number; shadow: number; recusadas: number; falhas: number };
}

const TIPOS_QUE_FALAM = new Set(["whatsapp.send_to_lead", "logic.ask", "logic.choice_menu"]);

function falaComOCliente(graph: unknown): boolean {
  const nos = (graph as { nodes?: { type?: unknown }[] } | null)?.nodes;
  return Array.isArray(nos) && nos.some((n) => typeof n.type === "string" && TIPOS_QUE_FALAM.has(n.type));
}

export async function lerPainel(admin: SupabaseClient, orgId: string): Promise<Painel> {
  const [ponteiros, agentes, fluxos, transicoes] = await Promise.all([
    admin.from("coord_politica_ponteiros").select("channel_session_id, versao_id").eq("organization_id", orgId),
    admin
      .from("ai_agents")
      .select("id, name, published_version_id, archived_at")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    admin.from("flows").select("id, name, status, active_version_id").eq("organization_id", orgId).order("name"),
    admin
      .from("coord_transicoes")
      .select("status")
      .eq("organization_id", orgId)
      .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .limit(5000),
  ]);

  const linhasPonteiro = (ponteiros.data ?? []) as { channel_session_id: string | null; versao_id: string }[];
  const idsDeVersao = linhasPonteiro.map((p) => p.versao_id);
  const { data: versoesDosPonteiros } =
    idsDeVersao.length > 0
      ? await admin
          .from("coord_politica_versoes")
          .select("id, numero, modo, config, channel_session_id, publicado_em")
          .eq("organization_id", orgId)
          .in("id", idsDeVersao)
      : { data: [] };
  const versoes = (versoesDosPonteiros ?? []) as {
    id: string;
    numero: number;
    modo: ModoDoCoordenador;
    config: unknown;
    channel_session_id: string | null;
    publicado_em: string;
  }[];

  const daOrg = versoes.find((v) => v.channel_session_id === null) ?? null;
  let politica: Politica = politicaSchema.parse({ modo: "off" });
  if (daOrg) {
    const { data: destinos } = await admin
      .from("coord_politica_destinos")
      .select("chave, tipo, agent_id, flow_id, quando_usar, exemplos, nao_usar, prioridade, permite_conduzir, permite_tarefa")
      .eq("organization_id", orgId)
      .eq("versao_id", daOrg.id)
      .order("prioridade", { ascending: false });
    const lido = politicaSchema.safeParse({
      modo: daOrg.modo,
      channel_session_id: null,
      config: daOrg.config ?? {},
      destinos: (destinos ?? []).map((d) => {
        const linha = d as Record<string, unknown>;
        return {
          ...linha,
          agent_id: linha.agent_id ?? null,
          flow_id: linha.flow_id ?? null,
        };
      }),
    });
    // Uma versão que não passa no schema de HOJE (campo removido, limite
    // apertado) não pode derrubar a tela: abre como desligada para corrigir.
    if (lido.success) politica = lido.data;
  }

  const { data: historicoBruto } = await admin
    .from("coord_politica_versoes")
    .select("id, numero, modo, publicado_em, channel_session_id")
    .eq("organization_id", orgId)
    .is("channel_session_id", null)
    .order("numero", { ascending: false })
    .limit(10);

  const flowIds = ((fluxos.data ?? []) as { active_version_id: string | null }[])
    .map((f) => f.active_version_id)
    .filter((v): v is string => typeof v === "string");
  const { data: grafos } =
    flowIds.length > 0
      ? await admin.from("flow_versions").select("id, graph").eq("organization_id", orgId).in("id", flowIds)
      : { data: [] };
  const grafoPorVersao = new Map(((grafos ?? []) as { id: string; graph: unknown }[]).map((g) => [g.id, g.graph]));

  const contagem = { aplicadas: 0, shadow: 0, recusadas: 0, falhas: 0 };
  for (const t of (transicoes.data ?? []) as { status: string }[]) {
    if (t.status === "aplicada") contagem.aplicadas += 1;
    else if (t.status === "shadow") contagem.shadow += 1;
    else if (t.status === "recusada" || t.status === "obsoleta") contagem.recusadas += 1;
    else if (t.status === "falhou") contagem.falhas += 1;
  }

  return {
    politica,
    versaoAtual: daOrg
      ? { versao_id: daOrg.id, numero: daOrg.numero, modo: daOrg.modo, publicado_em: daOrg.publicado_em, channel_session_id: null }
      : null,
    historico: ((historicoBruto ?? []) as { id: string; numero: number; modo: ModoDoCoordenador; publicado_em: string; channel_session_id: string | null }[]).map(
      (v) => ({ versao_id: v.id, numero: v.numero, modo: v.modo, publicado_em: v.publicado_em, channel_session_id: v.channel_session_id }),
    ),
    numerosComPoliticaPropria: versoes
      .filter((v): v is typeof v & { channel_session_id: string } => v.channel_session_id !== null)
      .map((v) => ({ channel_session_id: v.channel_session_id, modo: v.modo, numero: v.numero })),
    agentes: ((agentes.data ?? []) as { id: string; name: string; published_version_id: string | null }[]).map((a) => ({
      id: a.id,
      nome: a.name,
      publicado: a.published_version_id !== null,
    })),
    fluxos: ((fluxos.data ?? []) as { id: string; name: string; status: string; active_version_id: string | null }[]).map((f) => ({
      id: f.id,
      nome: f.name,
      ativo: f.status === "active" && f.active_version_id !== null,
      interativo: f.active_version_id !== null && falaComOCliente(grafoPorVersao.get(f.active_version_id)),
    })),
    resumo24h: contagem,
  };
}

export type ResultadoDaPublicacao =
  | { ok: true; versaoId: string; numero: number }
  | { ok: false; motivo: "destino_de_outra_organizacao" | "erro"; detalhe?: string };

/**
 * Publica uma versão NOVA (nunca edita a anterior) e move o ponteiro, numa
 * transação, pela RPC. A política já chega validada pelo `politicaSchema`.
 *
 * Os IDs de agente e fluxo são conferidos contra a organização ANTES da RPC —
 * o banco também recusa (trigger `fn_coord_mesma_org`), mas a mensagem daqui é
 * a que a tela consegue mostrar.
 */
export async function publicarPolitica(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; politica: Politica },
): Promise<ResultadoDaPublicacao> {
  const agentIds = p.politica.destinos.map((d) => d.agent_id).filter((v): v is string => typeof v === "string");
  const flowIds = p.politica.destinos.map((d) => d.flow_id).filter((v): v is string => typeof v === "string");
  if (agentIds.length > 0) {
    const { data } = await admin.from("ai_agents").select("id").eq("organization_id", p.orgId).in("id", agentIds);
    if ((data ?? []).length !== new Set(agentIds).size) return { ok: false, motivo: "destino_de_outra_organizacao" };
  }
  if (flowIds.length > 0) {
    const { data } = await admin.from("flows").select("id").eq("organization_id", p.orgId).in("id", flowIds);
    if ((data ?? []).length !== new Set(flowIds).size) return { ok: false, motivo: "destino_de_outra_organizacao" };
  }

  const { data, error } = await admin.rpc("fn_coord_publicar_politica" as never, {
    p_org: p.orgId,
    p_canal: p.politica.channel_session_id,
    p_modo: p.politica.modo,
    p_config: p.politica.config,
    p_destinos: p.politica.destinos,
    p_autor: p.userId,
  } as never);
  if (error) return { ok: false, motivo: "erro", detalhe: error.message.slice(0, 200) };
  const r = (data ?? {}) as { versao_id?: string; numero?: number };
  return { ok: true, versaoId: String(r.versao_id), numero: Number(r.numero) };
}

export interface LinhaDeAtividade {
  id: string;
  quando: string;
  conversation_id: string;
  de: string;
  para: string;
  categoria: string;
  motivo: string;
  motivo_legivel: string;
  status: string;
  modelo: string | null;
  custo_cents: number | null;
}

/**
 * O diário de transições em linguagem de quem opera: "Comercial → Cadastro,
 * porque o agente chamou um fluxo". Nomes resolvidos aqui, uma vez, em vez de
 * a tela fazer N consultas.
 */
export async function lerAtividade(admin: SupabaseClient, orgId: string, limite = 50): Promise<LinhaDeAtividade[]> {
  const { data } = await admin
    .from("coord_transicoes")
    .select("id, created_at, conversation_id, de_tipo, de_id, para_tipo, para_id, categoria, motivo, status, decisor_modelo, decisor_custo_cents")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limite, 1), 200));
  const linhas = (data ?? []) as {
    id: string;
    created_at: string;
    conversation_id: string;
    de_tipo: string | null;
    de_id: string | null;
    para_tipo: string | null;
    para_id: string | null;
    categoria: string;
    motivo: string;
    status: string;
    decisor_modelo: string | null;
    decisor_custo_cents: number | string | null;
  }[];

  const agentIds = new Set<string>();
  const execIds = new Set<string>();
  for (const l of linhas) {
    for (const [tipo, id] of [
      [l.de_tipo, l.de_id],
      [l.para_tipo, l.para_id],
    ] as const) {
      if (!id) continue;
      if (tipo === "agente") agentIds.add(id);
      if (tipo === "fluxo") execIds.add(id);
    }
  }
  const [agentes, execucoes] = await Promise.all([
    agentIds.size > 0
      ? admin.from("ai_agents").select("id, name").eq("organization_id", orgId).in("id", [...agentIds])
      : Promise.resolve({ data: [] }),
    execIds.size > 0
      ? admin.from("flow_executions").select("id, flows(name)").eq("organization_id", orgId).in("id", [...execIds])
      : Promise.resolve({ data: [] }),
  ]);
  const nomeDoAgente = new Map(((agentes.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const nomeDaExecucao = new Map(
    ((execucoes.data ?? []) as { id: string; flows: { name?: string } | { name?: string }[] | null }[]).map((e) => {
      const f = Array.isArray(e.flows) ? e.flows[0] : e.flows;
      return [e.id, f?.name ?? "Fluxo"];
    }),
  );
  const nome = (tipo: string | null, id: string | null): string => {
    if (tipo === "pessoa") return "Equipe";
    if (tipo === "nenhum" || tipo === null) return "Ninguém";
    if (tipo === "agente") return (id && nomeDoAgente.get(id)) ?? "Agente";
    if (tipo === "fluxo") return (id && nomeDaExecucao.get(id)) ?? "Fluxo";
    return tipo;
  };

  return linhas.map((l) => ({
    id: l.id,
    quando: l.created_at,
    conversation_id: l.conversation_id,
    de: nome(l.de_tipo, l.de_id),
    para: nome(l.para_tipo, l.para_id),
    categoria: l.categoria,
    motivo: l.motivo,
    motivo_legivel: l.motivo in MOTIVOS ? rotuloDoMotivo(l.motivo) : l.motivo,
    status: l.status,
    modelo: l.decisor_modelo,
    custo_cents: l.decisor_custo_cents === null ? null : Number(l.decisor_custo_cents),
  }));
}

/**
 * O rascunho da tela visto como o runtime o veria — para SIMULAR antes de
 * publicar. Elegibilidade e nome saem das mesmas listas que a tela mostra:
 * agente sem versão publicada e fluxo desligado existem na política e não
 * recebem conversa, exatamente como depois de publicados.
 */
export function politicaEfetivaDoRascunho(
  politica: Politica,
  agentes: readonly AgenteDisponivel[],
  fluxos: readonly FluxoDisponivel[],
): PoliticaEfetiva {
  return {
    versao_id: "rascunho",
    numero: 0,
    modo: politica.modo,
    channel_session_id: politica.channel_session_id,
    config: politica.config,
    destinos: politica.destinos.map((d) => {
      const agente = d.agent_id ? agentes.find((a) => a.id === d.agent_id) : undefined;
      const fluxo = d.flow_id ? fluxos.find((f) => f.id === d.flow_id) : undefined;
      return {
        id: `rascunho-${d.chave}`,
        chave: d.chave,
        tipo: d.tipo,
        agent_id: d.agent_id ?? null,
        flow_id: d.flow_id ?? null,
        nome: agente?.nome ?? fluxo?.nome ?? d.chave,
        quando_usar: d.quando_usar,
        exemplos: d.exemplos,
        nao_usar: d.nao_usar,
        prioridade: d.prioridade,
        permite_conduzir: d.permite_conduzir,
        permite_tarefa: d.permite_tarefa,
        elegivel: d.tipo === "agente" ? agente?.publicado === true : fluxo?.ativo === true,
        agent_version_id: null,
        flow_version_id: null,
      };
    }),
  };
}
