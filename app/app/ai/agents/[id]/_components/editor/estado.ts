/**
 * O estado do editor de agente — a forma do formulário, de onde ele se hidrata
 * e como vira a versão que o servidor grava.
 *
 * Mora fora do `AgentForm.tsx` para que cada seção do editor (um arquivo por
 * seção, em `editor/`) receba o MESMO tipo, em vez de cada uma redeclarar o
 * pedaço que usa. A conversão tela ↔ versão (`toVersionPayload`) fica num ponto
 * só: é ela que o painel Testar ensaia e que o Salvar envia.
 */
import { CHAVE_DA_INSTALACAO } from "../CredentialPicker";
import type { TriggerValue } from "../TriggerEditor";
import {
  VOZES_DO_AGENTE,
  VOZ_PADRAO,
  vozParaOServico,
  type ServicoDeVoz,
  type VozDoAgente,
} from "@/lib/ai/voz/vozes";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { Provider } from "@/hooks/ai/useCredentials";

export interface FollowupValue {
  enabled: boolean;
  flow_pointer_ids: string[];
}

export interface FormState {
  name: string;
  description: string;
  priority: number;
  provider: Provider;
  model: string;
  credential_id: string;
  channel_session_id: string;
  system_prompt: string;
  tool_ids: string[];
  trigger_config: TriggerValue;
  max_steps: number;
  token_budget: number;
  cost_budget_cents: number;
  history_message_window: number;
  history_token_window: number;
  handoff_keywords: string[];
  handoff_tool_enabled: boolean;
  cases_enabled: boolean;
  split_messages: boolean;
  split_max_chars: number;
  reply_as_audio: boolean;
  reply_as_audio_mirror: boolean;
  human_request_try_first: boolean;
  audio_voice: VozDoAgente;
  followup: FollowupValue;
  // Papel OPERADOR (spec 16 §3.2) — o que mexe no sistema depois da conversa.
  operator_enabled: boolean;
  /** "" = herda o modelo do Conversador (vira null no payload). */
  operator_model: string;
  operator_tool_ids: string[];
  pipeline_ids: string[];
  knowledge_source_ids: string[];
  api_endpoint_ids: string[];
}

/** O que toda seção do editor recebe: o formulário, como mudá-lo e os erros. */
export interface PropsDaSecao {
  form: FormState;
  patch: (p: Partial<FormState>) => void;
  disabled: boolean;
  erros: Record<string, string>;
}

const DEFAULT_FOLLOWUP: FollowupValue = { enabled: false, flow_pointer_ids: [] };

const DEFAULT_TRIGGER: TriggerValue = {
  events: ["message"],
  filters: {
    ignore_groups: true,
    ignore_self: true,
    keyword_regex: null,
    business_hours: null,
  },
  concurrency: "one_per_conversation",
};

export function buildState(args: {
  agent?: AgentRow;
  version: AgentVersionRow | null;
  servicoDeVoz?: ServicoDeVoz | null;
}): FormState {
  const { agent, version, servicoDeVoz } = args;
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    priority: agent?.priority ?? 0,
    provider: (version?.provider as Provider) ?? "anthropic",
    model: version?.model ?? "",
    // `null` gravado = a versão usa a chave da instalação. Sem esta tradução,
    // reabrir o agente mostraria o campo em branco e pediria para escolher de novo.
    credential_id: version ? (version.credential_id ?? CHAVE_DA_INSTALACAO) : "",
    channel_session_id: version?.channel_session_id ?? "",
    system_prompt:
      version?.system_prompt ??
      "Você é um atendente. Responda de forma educada e clara, em pt-BR.",
    tool_ids: version?.tool_ids ?? [],
    trigger_config: (version?.trigger_config as unknown as TriggerValue) ?? DEFAULT_TRIGGER,
    max_steps: version?.max_steps ?? 10,
    token_budget: version?.token_budget ?? 50_000,
    cost_budget_cents: version?.cost_budget_cents ?? 50,
    history_message_window: version?.history_message_window ?? 20,
    history_token_window: version?.history_token_window ?? 8_000,
    handoff_keywords: version?.handoff_keywords ?? [
      "falar com humano",
      "atendente",
      "pessoa real",
    ],
    handoff_tool_enabled: version?.handoff_tool_enabled ?? true,
    cases_enabled: version?.cases_enabled ?? false,
    split_messages: version?.split_messages ?? false,
    split_max_chars: version?.split_max_chars ?? 600,
    reply_as_audio: version?.reply_as_audio ?? false,
    reply_as_audio_mirror: version?.reply_as_audio_mirror ?? false,
    human_request_try_first: version?.human_request_try_first ?? false,
    // Voz fora do catálogo (vocabulário aberto no banco) abre na padrão em vez
    // de um Select em branco que o primeiro save trocaria em silêncio.
    // Com serviço, a voz é a do catálogo DELE (`pf_dora`, default da coluna,
    // não existe no Grok).
    audio_voice: servicoDeVoz
      ? vozParaOServico(version?.audio_voice ?? "", servicoDeVoz)
      : (VOZES_DO_AGENTE as readonly string[]).includes(version?.audio_voice ?? "")
        ? (version?.audio_voice as VozDoAgente)
        : VOZ_PADRAO,
    followup: version?.followup ?? DEFAULT_FOLLOWUP,
    operator_enabled: version?.operator_enabled ?? false,
    // O form usa "" onde o banco usa null — Select controlado não aceita null.
    // A conversão de volta acontece em `toVersionPayload`, num ponto só.
    operator_model: version?.operator_model ?? "",
    operator_tool_ids: version?.operator_tool_ids ?? [],
    // `?? []` = nenhum funil. Agente novo nasce fechado, como o banco.
    pipeline_ids: version?.pipeline_ids ?? [],
    // `?? []` = nenhum material. Mesma direção segura: agir de menos.
    knowledge_source_ids: version?.knowledge_source_ids ?? [],
    // `?? []` = nenhum sistema externo. Mesma direção segura.
    api_endpoint_ids: version?.api_endpoint_ids ?? [],
  };
}

export function toVersionPayload(s: FormState) {
  return {
    system_prompt: s.system_prompt,
    provider: s.provider,
    model: s.model,
    // O token é da TELA; o contrato da versão é `null` = chave da instalação.
    credential_id: s.credential_id === CHAVE_DA_INSTALACAO ? null : s.credential_id,
    tool_ids: s.tool_ids,
    trigger_config: s.trigger_config,
    channel_session_id: s.channel_session_id,
    max_steps: s.max_steps,
    token_budget: s.token_budget,
    cost_budget_cents: s.cost_budget_cents,
    history_message_window: s.history_message_window,
    history_token_window: s.history_token_window,
    handoff_keywords: s.handoff_keywords,
    handoff_tool_enabled: s.handoff_tool_enabled,
    cases_enabled: s.cases_enabled,
    split_messages: s.split_messages,
    split_max_chars: s.split_max_chars,
    reply_as_audio: s.reply_as_audio,
    reply_as_audio_mirror: s.reply_as_audio_mirror,
    human_request_try_first: s.human_request_try_first,
    audio_voice: s.audio_voice,
    followup: s.followup,
    operator_enabled: s.operator_enabled,
    // "" (não escolheu) → null (herda o do Conversador). São o mesmo conceito em
    // camadas diferentes, e o mapeamento vive AQUI para não se espalhar.
    operator_model: s.operator_model.trim() === "" ? null : s.operator_model.trim(),
    operator_tool_ids: s.operator_tool_ids,
    pipeline_ids: s.pipeline_ids,
    knowledge_source_ids: s.knowledge_source_ids,
    api_endpoint_ids: s.api_endpoint_ids,
  };
}

/** A versão como o formulário a salvaria (`toVersionPayload`). */
export type VersaoDoFormulario = ReturnType<typeof toVersionPayload>;

/**
 * Os campos que moram em "Ajustes avançados". A seção abre sozinha quando um
 * deles tem erro: esconder o campo que impede o Salvar seria pedir ao dono que
 * conserte o que ele não vê.
 */
export const CAMPOS_AVANCADOS = [
  "priority",
  "max_steps",
  "token_budget",
  "cost_budget_cents",
  "history_message_window",
  "history_token_window",
] as const satisfies ReadonlyArray<keyof FormState>;

export function avancadoTemErro(erros: Record<string, string>): boolean {
  return CAMPOS_AVANCADOS.some((campo) => erros[campo] !== undefined);
}

/**
 * JSON com as chaves em ordem — para comparar estados do formulário.
 *
 * `JSON.stringify` puro depende da ordem de inserção das chaves, e o Postgres
 * devolve `jsonb` com as chaves REORDENADAS. Um `trigger_config` salvo e relido
 * vinha com a mesma informação em outra ordem, e o formulário acusava
 * "alterações não salvas" que não existiam — o que trava o Publicar.
 */
export function chaveEstavel(valor: unknown): string {
  return JSON.stringify(valor, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** As colunas de `ai_agents` que o editor mostra — salvas fora da versão. */
export function identidadeDoForm(s: FormState) {
  return {
    name: s.name.trim(),
    description: s.description.trim() === "" ? null : s.description.trim(),
    priority: s.priority,
  };
}
