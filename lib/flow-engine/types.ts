/**
 * Flow Engine — o contrato de um nó.
 *
 * É o arquivo que justifica o motor novo. Os dois motores anteriores do repo
 * (`lib/automation`, `lib/followup`) sabem executar automação; nenhum dos dois
 * admite um TIPO DE NÓ NOVO sem edição espalhada — o grafo do follow-up é uma
 * união Zod fechada de 8 tipos, e crescer nela custa cinco arquivos. Aqui um nó
 * é uma DEFINIÇÃO registrada, e o motor não conhece nenhum tipo pelo nome.
 *
 * ⚠️ REGRA DURA: `execute` NUNCA fala com o Supabase. Recebe portas estreitas
 * (`ctx.crm`, `ctx.roteamento`, `ctx.canal`, `ctx.avisos`) para que todo nó seja
 * testável sem Postgres — a mesma razão pela qual `lib/followup/engine.ts`
 * declara `AdminClient` como interface em vez de usar `SupabaseClient` direto.
 * Um nó que importe `createAdminClient` está errado, e o teste de arquitetura
 * (`registry.test.ts`) reprova.
 */

import type { z } from "zod";

// ─────────────────────────── ramos (saídas do nó) ───────────────────────────

/**
 * A saída pega-tudo que TODO nó tem. Uma aresta que a referencia é o "senão"
 * do nó.
 *
 * Diferente do follow-up, aqui NÃO há dois dialetos de aresta: toda aresta
 * nomeia um `branch_id`, inclusive esta. O follow-up carrega `class_match` e
 * `cond_result` como resquício de uma v1, e o próprio arquivo dele documenta
 * que a tela pode desenhar certo enquanto o roteamento erra. Motor novo, um
 * dialeto só.
 */
export const RAMO_PADRAO = "else";

export type FlowBranchKind = "match" | "fallback";

export interface FlowBranch {
  /** Estável dentro do nó. Renomear o rótulo nunca solta a aresta. */
  id: string;
  /** O que o operador lê no handle. Pode mudar sem quebrar nada. */
  label: string;
  kind: FlowBranchKind;
}

export function ramoPadrao(label = "Senão"): FlowBranch {
  return { id: RAMO_PADRAO, label, kind: "fallback" };
}

// ─────────────────────────── resultado da execução ───────────────────────────

/**
 * O que um nó devolve. Fechado de propósito: o motor sabe reagir a estes cinco
 * casos e a mais nenhum, então um nó não pode inventar um estado que o motor
 * não persiste.
 */
export type NodeExecutionResult =
  /** Segue pela aresta que sai deste ramo. */
  | { kind: "advance"; branch_id: string; vars?: Record<string, unknown> }
  /**
   * Fica no nó até `next_eval_at`. O motor grava `wait_started` e, na volta,
   * entrega `ctx.esperaEmCurso` preenchido — é assim que o nó sabe que já
   * esperou, sem reler o banco.
   */
  | { kind: "wait"; next_eval_at: Date; motivo?: string }
  /** Termina a execução. */
  | { kind: "complete"; outcome: string; vars?: Record<string, unknown> }
  /** Falha REPETÍVEL: o motor tenta de novo com backoff até `max_attempts`. */
  | { kind: "fail"; error: string }
  /** Falha DEFINITIVA: não adianta repetir. Vai direto para `dead`. */
  | { kind: "dead"; reason: string };

// ──────────────────────────── fatos e variáveis ──────────────────────────────

/**
 * O que o motor carrega ANTES de executar o nó, para o nó não ter de buscar.
 * Campo ausente é `null` explícito e nunca `undefined` disfarçado de zero — um
 * lead recém-criado NÃO TEM score (`crm_lead_scores` só é escrito por
 * `recalculaScoreDoLead`, a partir do turno de conversa), e tratar essa ausência
 * como 0 faria "score < 70" ser verdadeiro para todo lead novo.
 */
export interface FatosDaExecucao {
  lead: {
    id: string;
    title: string;
    status: string;
    stage_id: string;
    pipeline_id: string;
    owner_user_id: string | null;
    value_cents: number | null;
    source: string;
    tags: string[];
    custom_fields: Record<string, unknown>;
    /** `crm_lead_scores.ai_probability`. `null` quando ainda não foi calculado. */
    score: number | null;
    /** `crm_lead_scores.ai_probability_band` — a faixa, quando existe. */
    score_band: string | null;
    created_at: string;
  } | null;
  contact: {
    id: string;
    name: string | null;
    phone_number: string | null;
    email: string | null;
    tags: string[];
    is_blocked: boolean;
  } | null;
  /** Dono atual do lead, quando há um e ele tem registro de atendente na org. */
  assigned_user: {
    id: string;
    name: string | null;
    notification_phone: string | null;
  } | null;
}

/** Escopo visível a `{{...}}`. Montado pelo motor; o nó só lê. */
export interface EscopoDeVariaveis {
  lead: FatosDaExecucao["lead"];
  contact: FatosDaExecucao["contact"];
  assigned_user: FatosDaExecucao["assigned_user"];
  /** `flow_executions.context` — o que os nós anteriores gravaram. */
  vars: Record<string, unknown>;
  execution: { id: string; started_at: string; steps_taken: number };
}

// ──────────────────────────────── as portas ──────────────────────────────────

export interface AtendenteElegivel {
  userId: string;
  /** Quando foi atribuído pela última vez. `null` = nunca, e vai na frente. */
  lastAssignedAt: string | null;
  currentLoad: number;
  capacity: number;
}

export interface PortaDeRoteamento {
  /**
   * Atendentes que PODEM receber agora: disponíveis, dentro do horário, com
   * heartbeat vivo e abaixo da capacidade. A regra é a de `lib/routing`, não uma
   * segunda cópia.
   */
  elegiveis(input: { organizationId: string }): Promise<AtendenteElegivel[]>;
}

export interface PortaDoCrm {
  atribuirDono(input: { leadId: string; userId: string }): Promise<void>;
  removerDono(input: { leadId: string }): Promise<void>;
  adicionarTag(input: { leadId: string; tag: string }): Promise<void>;
  /**
   * Houve mensagem de saída do dono nesta conversa depois de `desde`? É como o
   * fluxo pergunta "o vendedor respondeu?" sem o nó saber o que é uma tabela.
   */
  houveRespostaDoDono(input: {
    leadId: string;
    desde: string;
  }): Promise<boolean>;
}

export type DesfechoDeEnvio =
  | { kind: "enviado"; messageId: string }
  /** Saiu da fila do CRM mas ainda não do aparelho (fora de janela, número parado). */
  | { kind: "na_fila"; motivo: string }
  | { kind: "recusado"; motivo: string };

export interface PortaDeCanal {
  /**
   * Manda texto para um telefone E.164 que não é necessariamente um contato do
   * funil — é o caso do aviso ao vendedor.
   *
   * ⚠️ Passa pelo `sendMessageHandler`, nunca pelo adapter direto. O handler é
   * quem aplica bloqueio do contato, janela do número, pacing anti-banimento e
   * idempotência; um atalho pelo adapter economiza três linhas e arrisca o
   * número da empresa.
   */
  enviarTexto(input: {
    telefone: string;
    texto: string;
    /** Marca o contato criado para o aviso, para ele não virar lead nem falar com a IA. */
    interno: boolean;
  }): Promise<DesfechoDeEnvio>;
}

export type SeveridadeDoAviso = "info" | "warn" | "critical";

export interface PortaDeAvisos {
  abrir(input: {
    titulo: string;
    corpo: string;
    severidade: SeveridadeDoAviso;
    refId: string;
  }): Promise<void>;
}

// ─────────────────────────── contexto de execução ────────────────────────────

export interface EsperaEmCurso {
  desde: Date;
  ate: Date;
}

export interface FlowExecutionContext {
  organizationId: string;
  executionId: string;
  /** Id do nó sendo executado — o que as chaves de idempotência carregam. */
  nodeId: string;
  fatos: FatosDaExecucao;
  escopo: EscopoDeVariaveis;
  /**
   * Preenchido quando ESTE nó já pediu espera e o motor voltou a ele. `null` na
   * primeira visita. É o que impede um nó de espera de esperar para sempre —
   * e o motivo de a decisão ser do nó, não do motor: só o nó sabe se a espera
   * dele acabou ou se falta uma segunda.
   */
  esperaEmCurso: EsperaEmCurso | null;
  crm: PortaDoCrm;
  roteamento: PortaDeRoteamento;
  canal: PortaDeCanal;
  avisos: PortaDeAvisos;
  agora: () => Date;
  /** Interpola `{{lead.name}}` e afins contra `escopo`. */
  render: (texto: string) => string;
}

// ────────────────────────── a definição de um nó ─────────────────────────────

export const CATEGORIAS_DE_NO = [
  "trigger",
  "logic",
  "crm",
  "whatsapp",
  "routing",
  "notify",
] as const;
export type CategoriaDeNo = (typeof CATEGORIAS_DE_NO)[number];

export interface FlowNodeDefinition<C = unknown> {
  /** `crm.assign_owner`. Namespace por categoria, minúsculo, ponto e underscore. */
  type: string;
  /** Sobe quando o formato de `config` muda de um jeito que grafo antigo não lê. */
  version: number;
  category: CategoriaDeNo;
  /** Rótulo e ajuda em português — a paleta lê daqui, e um gate cobra a presença. */
  rotulo: string;
  descricao: string;
  configSchema: z.ZodType<C>;
  /**
   * Só em `category: "trigger"`: os `event_type` do `event_log` que armam este
   * fluxo. O matcher DERIVA a assinatura dele daqui — nunca de uma lista
   * digitada à parte, que é como as duas divergem em silêncio e um gatilho novo
   * fica registrado na tela sem nunca disparar.
   */
  eventos?: readonly string[];
  /**
   * Declara que este nó MUDA o CRM (dono, marcadores, etapa). O motor recarrega
   * os fatos depois dele, e os nós seguintes do mesmo tick veem o mundo novo.
   *
   * ⚠️ ESQUECER ISTO É UM DEFEITO SILENCIOSO, e foi medido: os fatos são
   * carregados UMA vez por tick, então `routing.round_robin` sem esta marca
   * atribuía o lead e o `whatsapp.notify_user` seguinte lia `assigned_user`
   * como `null` — o vendedor era escolhido e nunca avisado, sem erro nenhum.
   * A alternativa (recarregar sempre) custaria uma consulta por nó, inclusive
   * nos que só decidem.
   */
  mutaCrm?: boolean;
  /**
   * As saídas, na ordem em que o builder desenha os handles, com o pega-tudo
   * por último. Depende da config porque um `logic.if` com três regras tem
   * quatro saídas.
   */
  branches(config: C): FlowBranch[];
  execute(ctx: FlowExecutionContext, config: C): Promise<NodeExecutionResult>;
}
