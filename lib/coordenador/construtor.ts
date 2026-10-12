/**
 * O construtor de agente ("Criar agente com IA") também prepara o
 * coordenador: o agente novo entra como DESTINO da política da organização.
 *
 * Regras (decisão do dono do produto):
 *
 *   - sem política ainda → nasce uma, em OBSERVAR (shadow). O coordenador
 *     começa registrando o que faria, sem mudar nada para o cliente;
 *   - com política → uma versão NOVA copia a atual e acrescenta o destino. O
 *     MODO NUNCA MUDA: ligar o coordenador é decisão de quem administra, na
 *     tela dele, não efeito colateral de criar um agente;
 *   - agente que já é destino → a descrição dele é atualizada, sem duplicar;
 *   - fluxos marcados como "chamáveis" entram como destinos e o agente ganha
 *     permissão de chamá-los e voltar.
 *
 * O agente nasce em RASCUNHO: está na política, mas não recebe conversa até
 * ser publicado (o resolvedor só considera elegível versão publicada). A tela
 * de revisão diz isso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import { lerPainel, publicarPolitica } from "./painel";
import { chaveDoNome, politicaSchema, type Destino, type Politica } from "./politica/schema";

export interface CoordenacaoDoConstrutor {
  quando_usar: string;
  exemplos: string[];
  nao_usar: string[];
  /** Fluxos que este agente pode chamar e voltar. */
  fluxos_chamaveis: string[];
}

export interface FluxoParaPolitica {
  id: string;
  nome: string;
}

/**
 * A política nova, sem I/O. `atual` null = a organização ainda não tem
 * coordenador. Devolve também a chave que o agente recebeu.
 */
export function politicaComAgente(
  atual: Politica | null,
  agente: { id: string; nome: string },
  coordenacao: CoordenacaoDoConstrutor,
  fluxos: readonly FluxoParaPolitica[],
): { politica: Politica; chave: string; criada: boolean } {
  const base: Politica = atual ?? politicaSchema.parse({ modo: "shadow" });
  const destinos: Destino[] = [...base.destinos];
  const usadas = new Set(destinos.map((d) => d.chave));

  const existente = destinos.findIndex((d) => d.tipo === "agente" && d.agent_id === agente.id);
  const descricao = {
    quando_usar: coordenacao.quando_usar.trim().slice(0, 600),
    exemplos: coordenacao.exemplos.map((e) => e.trim().slice(0, 200)).filter(Boolean).slice(0, 12),
    nao_usar: coordenacao.nao_usar.map((e) => e.trim().slice(0, 200)).filter(Boolean).slice(0, 12),
  };
  let chave: string;
  if (existente >= 0) {
    chave = destinos[existente]!.chave;
    destinos[existente] = { ...destinos[existente]!, ...descricao };
  } else {
    chave = chaveDoNome(agente.nome, usadas);
    usadas.add(chave);
    destinos.push({
      chave,
      tipo: "agente",
      agent_id: agente.id,
      flow_id: null,
      ...descricao,
      prioridade: 0,
      permite_conduzir: true,
      permite_tarefa: false,
    });
  }

  const chavesDosFluxos: string[] = [];
  for (const id of coordenacao.fluxos_chamaveis) {
    const fluxo = fluxos.find((f) => f.id === id);
    if (!fluxo) continue;
    const ja = destinos.find((d) => d.tipo === "fluxo" && d.flow_id === id);
    if (ja) {
      chavesDosFluxos.push(ja.chave);
      continue;
    }
    const k = chaveDoNome(fluxo.nome, usadas);
    usadas.add(k);
    destinos.push({
      chave: k,
      tipo: "fluxo",
      agent_id: null,
      flow_id: id,
      quando_usar: "",
      exemplos: [],
      nao_usar: [],
      prioridade: 0,
      permite_conduzir: true,
      permite_tarefa: false,
    });
    chavesDosFluxos.push(k);
  }

  const permissoes = { ...base.config.permissoes };
  if (chavesDosFluxos.length > 0) {
    const atualDoAgente = permissoes[chave] ?? { pode_chamar: [], pode_transferir: [] };
    permissoes[chave] = {
      ...atualDoAgente,
      pode_chamar: [...new Set([...atualDoAgente.pode_chamar, ...chavesDosFluxos])].slice(0, 20),
    };
  }

  const politica = politicaSchema.parse({
    ...base,
    config: {
      ...base.config,
      // Primeiro destino de uma política nova: é também o padrão — sem ele, a
      // primeira mensagem sem regra e sem modelo não teria para onde ir.
      destino_padrao: base.config.destino_padrao ?? (atual === null ? chave : null),
      permissoes,
    },
    destinos,
  });
  return { politica, chave, criada: atual === null };
}

export type ResultadoNoCoordenador =
  | { ok: true; numero: number; modo: Politica["modo"]; criada: boolean }
  | { ok: false; motivo: string };

/**
 * Lê a política em vigor, acrescenta o agente e publica uma versão nova.
 * Nunca lança: o agente já foi criado, e falhar aqui não pode desfazê-lo —
 * a pessoa vê o resultado e pode ajustar na tela do coordenador.
 */
export async function incluirAgenteNoCoordenador(
  admin: SupabaseClient,
  ctx: { orgId: string; userId: string; requestId: string },
  agente: { id: string; nome: string },
  coordenacao: CoordenacaoDoConstrutor,
): Promise<ResultadoNoCoordenador> {
  try {
    const painel = await lerPainel(admin, ctx.orgId);
    if (painel.versaoAtual && !painel.politicaLegivel) return { ok: false, motivo: "politica_ilegivel" };
    const atual = painel.versaoAtual ? painel.politica : null;
    const { politica, criada } = politicaComAgente(
      atual,
      agente,
      coordenacao,
      painel.fluxos.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: f.nome })),
    );
    const r = await publicarPolitica(admin, { orgId: ctx.orgId, userId: ctx.userId, politica });
    if (!r.ok) return { ok: false, motivo: r.motivo };
    void audit({
      action: "coordenador.politica_publicada",
      actorUserId: ctx.userId,
      organizationId: ctx.orgId,
      resourceType: "coordenador",
      resourceId: r.versaoId,
      requestId: ctx.requestId,
      metadata: { numero: r.numero, modo: politica.modo, origem: "construtor", agent_id: agente.id, criada },
    });
    return { ok: true, numero: r.numero, modo: politica.modo, criada };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message.slice(0, 160) : "erro" };
  }
}
