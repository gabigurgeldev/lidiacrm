/**
 * SEAM ÚNICO de chamada de modelo: TODA chamada de LLM do harness passa por
 * runModelCall — agente, classificadores auxiliares e compaction usam esta MESMA
 * função (nenhum call site instancia provider).
 *
 * Por chamada: resolve a config da org no DB (BYOK em ai_provider_credentials +
 * knobs em organizations.settings->'llm'; troca de modelo/provider = UPDATE na
 * config, vale no run seguinte, sem restart) → checa o budget mensal ANTES de
 * sair byte para o provider → generateText do AI SDK → grava usage/custo em
 * llm_calls. A chave da org nunca entra em prompt, tool result ou log — ela só
 * cruza a fronteira na instância do provider.
 *
 * Shape do usage: `LanguageModelUsage` (node_modules/ai/dist/index.d.ts):
 * inputTokens/outputTokens totais + inputTokenDetails.{cacheReadTokens,
 * cacheWriteTokens}. Validado no ai@7 via scripts/smoke-llm.sh (modelo real) —
 * upgrade de major re-valida esses paths pelo mesmo gate (regra dura 16).
 */
import { generateText, stepCountIs, type ModelMessage, type ToolChoice, type ToolSet } from 'ai';
import type pg from 'pg';
import { z } from 'zod';

import { scrubMessage } from '@/lib/sentry/scrub';

import type { Logger } from '../../obs/logger';
import { decidirParaOSeam } from './binding-do-ponto';
import { resolveOrgLlmConfig, type LlmEdgeConfig, type OrcamentoDaOrg } from './credentials';
import {
  AVISO_CORPO,
  AVISO_TITULO,
  BLOQUEIO_TITULO,
  corpoDoBloqueio,
  decidirOrcamento,
  normalizarModoDeOrcamento,
  LIMIAR_PADRAO_PCT,
  SQL_ORCAMENTO,
  type ChaveDeOrcamento,
} from './orcamento';
import { costCents } from './pricing';
import { createDefaultRegistry, type ProviderRegistry } from './providers';
import { buildStablePrefix } from './stable-prefix';

// Call sites FORA da camada importam os tipos daqui — nunca de 'ai' direto
// (o seam é a única porta). `tool` idem: é como o agente define ToolSet sem
// tocar no SDK.
export { tool } from 'ai';
export type { ModelMessage, ToolSet } from 'ai';
export type { LlmEdgeConfig } from './credentials';
export { llmEdgeConfigFromEnv, LlmNotConfiguredError } from './credentials';

/** Teto mensal da org esgotado — runs recusados ANTES do provider (zero tokens). */
export class LlmBudgetExceededError extends Error {
  override readonly name = 'llm_budget_exceeded';
  /**
   * Veto PERMANENTE de negócio, não incidente de sistema — tentar de novo daqui
   * a um minuto dá o mesmo resultado, porque o gasto não diminui sozinho.
   *
   * Quem lê isto é a fila (`workers/agent-worker/main.ts`), para mandar o job
   * ao `cancelJob` em vez do `failJob`: sem isso, um bloqueio produz N conversas
   * × `max_attempts` tentativas e N alertas CRÍTICOS `job_dead` sem dedup,
   * afogando o único `budget_exceeded` — que é o alerta que explica. O
   * REPONTAMENTO da fila é da onda seguinte; o rótulo entra aqui, com o erro.
   */
  readonly terminal = true;
  constructor() {
    super('orçamento mensal de IA da organização atingido — chamada recusada antes de sair byte para o provedor; ajuste o teto em Uso de IA › Orçamento, desligue a proteção, ou aguarde a virada do mês (agent_inbox_items kind=budget_exceeded)');
  }
}

/** Provider da config sem entrada no registry — erro de config, nunca fallback. */
export class LlmProviderUnknownError extends Error {
  override readonly name = 'llm_provider_unknown';
  constructor(provider: string) {
    super(`provider LLM desconhecido na config da org: ${provider}`);
  }
}

/** Modelo pedido fora de enabled_models da org. */
export class LlmModelNotEnabledError extends Error {
  override readonly name = 'llm_model_not_enabled';
  constructor(model: string) {
    super(`modelo não habilitado para a org (enabled_models): ${model}`);
  }
}

/**
 * A chamada passou do tempo máximo do seu `purpose` e foi ABORTADA por nós.
 *
 * Até existir este teto, uma chamada que o provedor nunca respondia prendia o
 * job inteiro: medido em produção (2026-10-06), o `checkpoint` de um turno não
 * voltou, o job ficou `running`, foi reaberto a cada 10 min pelo visibility
 * timeout até morrer na 5ª tentativa — e, como a fila é serial por contato, a
 * mensagem seguinte do cliente esperou 65 minutos. Sem linha em `llm_calls`,
 * porque a chamada nunca terminava nem falhava.
 */
export class LlmTempoEsgotadoError extends Error {
  override readonly name = 'llm_tempo_esgotado';
  constructor(
    readonly purpose: string,
    readonly limiteMs: number,
    options?: { cause?: unknown },
  ) {
    super(`chamada de modelo (${purpose}) passou de ${Math.round(limiteMs / 1000)}s e foi abortada`, options);
  }
}

/**
 * Classificadores devolvem uma palavra ou um veredito curto: 20 s é folga
 * generosa para um modelo sem raciocínio, e o que passa disso é provedor
 * travado ou modelo pensando demais para a tarefa.
 */
const PURPOSES_CLASSIFICADORES = new Set([
  'stage_classifier',
  'jailbreak_detect',
  'promise_semantic',
  'intent_router',
  'followup_classify',
  'classify',
  'coordenador_decidir',
]);
/** Resumos rodam DEPOIS da resposta: não atrasam o cliente, mas seguram o job. */
const PURPOSES_RESUMO = new Set(['checkpoint', 'compaction', 'flush']);

export const TEMPO_MAXIMO_PADRAO_MS = {
  classificador: 20_000,
  resumo: 90_000,
  /** Turnos com ferramentas (vários passos): agente, operador, follow-up. */
  padrao: 120_000,
} as const;

/**
 * Teto de tempo da chamada inteira (todos os passos e retries do SDK), por
 * `purpose`. Ajustável pelo operador via env (`LLM_TIMEOUT_*_MS`, lidos em
 * `llmEdgeConfigFromEnv`); o default vive aqui para valer também em quem monta
 * a config na mão (testes, worker de mídia).
 */
export function tempoMaximoDaChamadaMs(purpose: string, cfg: Pick<LlmEdgeConfig, 'tempoMaximoMs'>): number {
  const t = cfg.tempoMaximoMs ?? {};
  if (PURPOSES_CLASSIFICADORES.has(purpose)) return t.classificador ?? TEMPO_MAXIMO_PADRAO_MS.classificador;
  if (PURPOSES_RESUMO.has(purpose)) return t.resumo ?? TEMPO_MAXIMO_PADRAO_MS.resumo;
  return t.padrao ?? TEMPO_MAXIMO_PADRAO_MS.padrao;
}

// Whitelist de params da org (jsonb livre no DB → só o que o seam entende passa).
const paramsSchema = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().int().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .passthrough();

export interface RunModelCallInput {
  tenantId: string;
  leadId?: string | null;
  jobId?: string | null;
  variantId?: string | null;
  /** atribuição de custo: 'agent_turn' (default) | 'classifier' | 'compaction' | 'connection_test' */
  purpose?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  /**
   * Override do modelo default da org — é como classificador/compaction usam um
   * modelo pequeno pela MESMA camada. Sujeito a enabled_models quando a lista
   * não é vazia. NUNCA um id hardcoded: o valor vem de config de quem chama.
   */
  model?: string;
  /**
   * Teto do loop de tool-calls do generateText (vira stopWhen: stepCountIs). Sem
   * ele o SDK para no 1º step (default stepCountIs(1)) — tools executam mas o
   * modelo não vê o resultado. Quem chama passa o knob (ex.: AGENT_MAX_STEPS do
   * agente), nunca constante.
   */
  maxSteps?: number;
  /**
   * Obriga (ou proíbe) o modelo a chamar ferramenta. Ausente = o default do SDK
   * ('auto'). Quem usa: o passo de resgate do turno mudo (inbound-turn.ts), que
   * precisa que o modelo responda por `send_message` ou passe a conversa — e
   * não que escreva texto solto, que o runtime descarta.
   */
  toolChoice?: ToolChoice<ToolSet>;
  /**
   * Override de provider/credencial vindo da versão PUBLICADA do agente (Fase
   * 2B) — resolvido no seam, nunca no call site. Sem ele, config da org.
   */
  llmOverride?: import('./credentials').LlmResolveOverride;
}

export interface RunModelCallDeps {
  registry?: ProviderRegistry;
  log?: Logger;
}

/**
 * Texto do aviso de limiar. É PONTEIRO, não retrato: manda ver os números na
 * tela em vez de congelar um "80%" que envelhece no mesmo minuto em que o gasto
 * sobe. O statement do gate insere este item de dentro do banco, junto com a
 * leitura, e por isso os números do momento ainda não existem em JS quando o
 * texto é montado — a escolha do ponteiro transforma essa limitação em acerto.
 *
 * A cópia mora em `./orcamento` porque o caminho legado
 * (`workers/ai-response-worker.ts`) abre os MESMOS dois itens e não pode
 * importar este arquivo (ele arrastaria `pg` e o SDK para o bundle do Next).
 */

/** O que o statement do gate devolve — uma ida ao banco, um snapshot. */
interface LinhaDoOrcamento {
  teto: number | string | null;
  modo: string | null;
  efetivo_em: Date | null;
  limiar_pct: number | string | null;
  /** `numeric` do Postgres chega como STRING no node-pg. Sempre coagir. */
  gasto: string | number | null;
  avisado_antes: boolean | null;
}

/**
 * O GATE — lê o estado, deixa `decidirOrcamento` decidir, e executa o veredito.
 *
 * ═══ POR QUE ELE NÃO DECIDE NADA POR CONTA PRÓPRIA ═══
 *
 * A regra inteira mora em `./orcamento.ts`, pura e testável sem banco. Aqui só
 * há I/O: uma query, um insert quando bloqueia, um log. As duas condições
 * repetidas abaixo (`modo === 'off'` e `chave === 'off'`) NÃO são uma segunda
 * cópia da regra — são um atalho de CUSTO, e o que as autoriza é que a função
 * pura devolve `seguir` para as duas sob qualquer outro valor de entrada. Essa
 * concordância é cobrada por teste; se alguém mudar a função e não o atalho, o
 * teste vermelhece antes do cliente.
 *
 * ═══ O CUSTO NO CAMINHO QUENTE ═══
 *
 * Com `enforcement_mode = 'off'` — 100% das organizações no dia do upgrade,
 * porque a coluna nasce assim por DEFAULT — o gate volta ANTES de qualquer
 * query. É estritamente menos trabalho que o `assertBudget` de antes, que ia ao
 * banco somar `llm_calls` sempre que o jsonb tivesse um número.
 *
 * ═══ FALHA ABERTA NA AÇÃO, ABERTA NA INFORMAÇÃO ═══
 *
 * Erro na leitura do orçamento NUNCA bloqueia: o cliente não pode perder o
 * agente porque uma query falhou. Mas a causa vai para o log, nomeada — a frase
 * tranquilizadora sozinha é o que faz um defeito viver meses.
 */
async function aplicarOrcamento(d: {
  db: pg.Pool;
  organizationId: string;
  /** Só para o atalho de custo. A decisão usa o snapshot de `SQL_ORCAMENTO`. */
  orcamentoDaConfig: OrcamentoDaOrg;
  orcamentoIndisponivelPorque: string | null;
  chave: ChaveDeOrcamento;
  purpose: string;
  provider: string;
  model: string;
  origem: string;
  input: RunModelCallInput;
  log?: Logger;
}): Promise<void> {
  const comum = { organization_id: d.organizationId, purpose: d.purpose };

  if (d.orcamentoIndisponivelPorque !== null) {
    d.log?.warn('llm: orçamento não pôde ser lido — a chamada SEGUE sem teto', {
      ...comum,
      causa: d.orcamentoIndisponivelPorque,
    });
    return;
  }
  if (d.orcamentoDaConfig.modo === 'off' || d.chave === 'off') {
    return;
  }

  const inicio = Date.now();
  let linha: LinhaDoOrcamento | undefined;
  try {
    const { rows } = await d.db.query<LinhaDoOrcamento>(SQL_ORCAMENTO, [
      d.organizationId,
      AVISO_TITULO,
      AVISO_CORPO,
    ]);
    linha = rows[0];
  } catch (err) {
    d.log?.warn('llm: consulta de orçamento falhou — a chamada SEGUE sem teto', {
      ...comum,
      ...normalizarErro(err),
    });
    return;
  }
  if (linha === undefined) {
    // `select` de CTEs escalares sempre devolve uma linha; zero linhas aqui é
    // um mundo que não deveria existir, e nele a resposta segue sendo a frouxa.
    d.log?.warn('llm: consulta de orçamento não devolveu linha — a chamada SEGUE', comum);
    return;
  }

  const gastoCents = Number(linha.gasto ?? 0);
  const tetoCents = Number(linha.teto ?? 0);
  const veredito = decidirOrcamento({
    modo: normalizarModoDeOrcamento(linha.modo),
    tetoCents,
    gastoCents,
    efetivoEm: linha.efetivo_em ?? null,
    agora: new Date(),
    purpose: d.purpose,
    chave: d.chave,
    limiarPct: Number(linha.limiar_pct ?? LIMIAR_PADRAO_PCT),
    avisadoNesteMes: linha.avisado_antes === true,
  });

  if (veredito.acao === 'seguir') {
    return;
  }
  if (veredito.acao === 'avisar_e_seguir') {
    // O item da Central já foi aberto pelo próprio statement (CTE `avisa`), no
    // mesmo snapshot que decidiu — aqui só sobra o log.
    d.log?.warn('llm: gasto de IA passou do aviso — a chamada SEGUE', {
      ...comum,
      porque: veredito.porque,
      gasto_cents: gastoCents,
      teto_cents: tetoCents,
    });
    return;
  }

  const erro = new LlmBudgetExceededError();
  // `ref_kind`/`ref_id` existem para que ALGUÉM possa fechar este item: o
  // insert anterior não gravava ref nenhum, e por isso nenhum auto-resolvedor
  // o alcançava — virava o mês, a IA voltava, e o alerta crítico continuava
  // aceso. Estado falso é pior que ausente, porque quem lê age sobre ele.
  await d.db.query(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
     select $1, 'budget_exceeded', 'critical', $2, $3, 'ai_budget', $1
     where not exists (
       select 1 from agent_inbox_items
       where organization_id = $1 and kind = 'budget_exceeded' and status = 'open'
     )`,
    [d.organizationId, BLOQUEIO_TITULO, corpoDoBloqueio(gastoCents, tetoCents)],
  );
  // A recusa vira LINHA em llm_calls. A tela /app/ai/runs nasceu porque
  // "llm_calls só registrava sucesso — a tabela ficava vazia exatamente no caso
  // que precisava de explicação", e o único caso em que o agente para DE
  // PROPÓSITO era justamente o que continuava invisível: o `throw` de antes
  // caía fora do `try` que grava a falha. É o irmão que não foi replantado
  // quando a 0128 consertou a classe.
  await registrarFalha(d.db, {
    input: d.input,
    purpose: d.purpose,
    provider: d.provider,
    model: d.model,
    origem: d.origem,
    latencyMs: Date.now() - inicio,
    erro,
  }).catch(() => {
    // Gravar a recusa não pode impedir a recusa.
  });
  d.log?.warn('llm: chamada recusada por orçamento', {
    ...comum,
    provider: d.provider,
    model: d.model,
    gasto_cents: gastoCents,
    teto_cents: tetoCents,
  });
  throw erro;
}

export async function runModelCall(db: pg.Pool, cfg: LlmEdgeConfig, input: RunModelCallInput, deps: RunModelCallDeps = {}) {
  const registry = deps.registry ?? createDefaultRegistry();
  const purpose = input.purpose ?? 'agent_turn';

  // Contabilidade separada (só o ensaio): orçamento e `llm_calls` por outra
  // conexão, sem contato nem job — eles só existem dentro da transação que será
  // desfeita, e uma FK para eles quebraria o insert de fora.
  const contabil = cfg.contabilidade;
  const dbDaConta = contabil?.db ?? db;
  const inputDaConta: RunModelCallInput =
    contabil === undefined ? input : { ...input, leadId: null, jobId: null, variantId: null };
  const purposeDaConta = contabil === undefined ? purpose : `${contabil.prefixoDoProposito}${purpose}`;

  // A config da org é lida ANTES da decisão porque o resolvedor precisa dela
  // como último degrau da precedência (o padrão, quando ninguém mais opinou).
  const padrao = await resolveOrgLlmConfig(db, cfg, input.tenantId, input.llmOverride);

  // O painel de provedores entra AQUI, e é o que faz `purpose` deixar de ser
  // só um rótulo de custo e virar decisão. Sem binding configurado, `decisao`
  // reproduz exatamente o comportamento anterior — a origem volta como
  // 'variavel_de_ambiente' ou 'padrao_da_organizacao'.
  const decisao = await decidirParaOSeam(db, {
    organizationId: input.tenantId,
    purpose,
    modeloDoCallSite: input.model,
    overrideDoAgente:
      input.llmOverride === undefined
        ? null
        : {
            provider: input.llmOverride.provider ?? padrao.provider,
            credentialId: input.llmOverride.credentialId ?? null,
            model: input.model,
          },
    padraoDaOrganizacao: { provider: padrao.provider, defaultModel: padrao.defaultModel },
  }, deps.log ? { log: deps.log } : {});

  // Só re-resolve a credencial quando a decisão aponta para OUTRA que não a já
  // carregada — decifrar duas vezes a mesma chave é custo puro no caminho
  // quente, e cada decifragem é mais um instante com plaintext em memória.
  //
  // A condição olha para o QUE FOI DECIDIDO, nunca para o rótulo da origem. Ela
  // já foi `decisao.origem === 'binding' && (…)`, e amarrar a correção a um
  // rótulo é o que permite decisão e execução divergirem: qualquer ramo que
  // devolvesse um provider fora do já resolvido saía com a chave do outro —
  // silenciosamente, porque `factory` usa `config.provider` e não
  // `decisao.provider`. `padrao` foi resolvido com `input.llmOverride`, então
  // comparar contra ele é comparar contra o que de fato está carregado.
  const credencialJaCarregada = input.llmOverride?.credentialId ?? null;
  const precisaOutraCredencial =
    decisao.provider !== padrao.provider ||
    (decisao.credentialId !== null && decisao.credentialId !== credencialJaCarregada);

  const config = precisaOutraCredencial
    ? await resolveOrgLlmConfig(db, cfg, input.tenantId, {
        provider: decisao.provider,
        credentialId: decisao.credentialId,
      })
    : padrao;

  const model = decisao.modelId;
  if (model === null || model === undefined) {
    throw new Error(
      'modelo LLM não definido — configure o ponto no painel de provedores, ' +
        'organizations.settings.llm.default_model, ou passe input.model',
    );
  }
  if (config.enabledModels.length > 0 && !config.enabledModels.includes(model)) {
    throw new LlmModelNotEnabledError(model);
  }
  const factory = registry[config.provider];
  if (factory === undefined) {
    throw new LlmProviderUnknownError(config.provider);
  }
  const parsedParams = paramsSchema.safeParse(config.params);
  if (!parsedParams.success) {
    throw new Error('params inválidos em organizations.settings.llm.params — corrija a config da org');
  }
  const { temperature, topP, topK, maxOutputTokens } = parsedParams.data;

  // ═══ O TETO, LOGO ANTES DE SAIR BYTE ═══
  //
  // Fica DEPOIS da resolução de modelo/provider, e não antes como o
  // `assertBudget` de origem, por uma razão de informação: a recusa agora vira
  // linha em `llm_calls`, e aquela tabela tem `model text not null`. Chamado no
  // ponto antigo, o gate teria de inventar um nome de modelo para gravar — e um
  // valor inventado numa tabela de auditoria é pior que a linha faltando.
  // Continua ANTES de qualquer byte ao provedor, que é a propriedade que
  // importa: bloqueio custa zero token.
  await aplicarOrcamento({
    db: dbDaConta,
    organizationId: input.tenantId,
    orcamentoDaConfig: config.orcamento,
    orcamentoIndisponivelPorque: config.orcamentoIndisponivelPorque,
    chave: cfg.budgetEnforcement ?? 'on',
    purpose,
    provider: config.provider,
    model,
    origem: decisao.origem,
    input: inputDaConta,
    ...(deps.log ? { log: deps.log } : {}),
  });

  // Disciplina de cache: o prefixo estável org-wide (system do playbook + tools
  // em ordem determinística) ganha os breakpoints AQUI, no seam — call sites
  // passam system/tools crus. Tudo por-lead vive em input.messages, DEPOIS do
  // breakpoint. TTL: knob LLM_CACHE_TTL; '1h' é a doutrina.
  const prefix = buildStablePrefix({
    system: input.system,
    tools: input.tools,
    cacheTtl: cfg.cacheTtl ?? '1h',
  });

  const startedAt = Date.now();
  const limiteMs = tempoMaximoDaChamadaMs(purpose, cfg);
  const prazo = AbortSignal.timeout(limiteMs);
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    // `system` aceita SystemModelMessage (com providerOptions de cache) — igual
    // em v6 e v7 (smoke prova que o cacheControl continua virando cache_control).
    result = await generateText({
      // `decisao.baseUrl` só é preenchido quando o painel apontou um endpoint
      // (gateway OpenAI-compatível, ou modelo local). Providers canônicos
      // ignoram o terceiro argumento e vão ao endpoint intrínseco.
      model: factory(config.apiKey, model, decisao.baseUrl ?? undefined),
      system: prefix.system,
      messages: input.messages,
      tools: prefix.tools,
      stopWhen: input.maxSteps === undefined ? undefined : stepCountIs(input.maxSteps),
      ...(input.toolChoice !== undefined ? { toolChoice: input.toolChoice } : {}),
      temperature,
      topP,
      topK,
      maxOutputTokens,
      // O prazo cobre a chamada INTEIRA — passos de ferramenta e retries do SDK
      // inclusive. Classificador tenta uma vez a mais, não duas: o retry dele
      // é o turno seguinte.
      abortSignal: prazo,
      ...(PURPOSES_CLASSIFICADORES.has(purpose) ? { maxRetries: 1 } : {}),
    });
  } catch (errOriginal) {
    // Aborto pelo NOSSO prazo vira erro tipado: o SDK embrulha o DOMException
    // de jeitos diferentes por versão, e é o sinal que diz com certeza quem parou.
    const err = prazo.aborted ? new LlmTempoEsgotadoError(purpose, limiteMs, { cause: errOriginal }) : errOriginal;
    // ─── A LINHA QUE FALTAVA ────────────────────────────────────────────────
    //
    // Até aqui o INSERT em llm_calls vivia só DEPOIS desta chamada, sem `try`
    // em volta. Provedor recusou a chave, modelo não existe, conta sem saldo? A
    // exceção subia e NADA ficava gravado. A tabela que deveria explicar era
    // justamente a que ficava vazia no caso que precisa de explicação — e é a
    // causa direta de "o agente não responde e não aparece erro em lugar
    // nenhum".
    //
    // Grava e RELANÇA: quem chama continua decidindo o que fazer com a falha
    // (o worker reagenda, o dry-run mostra na tela). Engolir aqui trocaria uma
    // falha invisível por uma silenciosa, que é pior.
    contabil?.aoRegistrar?.({
      purpose,
      provider: config.provider,
      model,
      status: 'erro',
      inputTokens: 0,
      outputTokens: 0,
      costCents: null,
      latencyMs: Date.now() - startedAt,
    });
    await registrarFalha(dbDaConta, {
      input: inputDaConta,
      purpose: purposeDaConta,
      provider: config.provider,
      model,
      origem: decisao.origem,
      latencyMs: Date.now() - startedAt,
      erro: err,
    }).catch(() => {
      // O log da falha não pode causar uma segunda falha. Se o próprio INSERT
      // de erro falhar, o erro ORIGINAL é o que interessa a quem chamou.
    });
    deps.log?.error('llm: chamada falhou', {
      organization_id: input.tenantId,
      purpose,
      provider: config.provider,
      model,
      origem_da_escolha: decisao.origem,
      ...normalizarErro(err),
    });
    throw err;
  }
  const latencyMs = Date.now() - startedAt;

  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
  };
  const cost = costCents(model, usage);

  const { rows } = await dbDaConta.query<{ id: string }>(
    `insert into llm_calls
       (organization_id, contact_id, job_id, variant_id, purpose, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents, latency_ms,
        status, origem_da_escolha)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ok', $14)
     returning id`,
    [
      inputDaConta.tenantId,
      inputDaConta.leadId ?? null,
      inputDaConta.jobId ?? null,
      inputDaConta.variantId ?? null,
      purposeDaConta,
      config.provider,
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      cost,
      latencyMs,
      decisao.origem,
    ],
  );

  contabil?.aoRegistrar?.({
    purpose,
    provider: config.provider,
    model,
    status: 'ok',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costCents: cost,
    latencyMs,
  });

  // Só métricas — nunca conteúdo de mensagem (PII) nem chave.
  deps.log?.info('llm: chamada concluída', {
    organization_id: input.tenantId,
    provider: config.provider,
    model,
    purpose,
    // POR QUE este modelo, e não só QUAL: é a diferença entre um log que
    // confirma o que aconteceu e um que explica uma configuração que não
    // pegou. Vira coluna em llm_calls na frente de logs.
    origem_da_escolha: decisao.origem,
    ...usage,
    cost_cents: cost,
    latency_ms: latencyMs,
  });
  for (const aviso of decisao.avisos) {
    deps.log?.warn('llm: configuração do ponto tem incoerência', {
      organization_id: input.tenantId,
      purpose,
      aviso,
    });
  }

  return {
    result,
    callId: rows[0]?.id ?? null,
    provider: config.provider,
    model,
    usage,
    costCents: cost,
    latencyMs,
    /** De onde veio a escolha — o painel lê isto para explicar cada ponto. */
    origem: decisao.origem,
    avisos: decisao.avisos,
  };
}

/**
 * Classifica o erro do provedor num vocabulário nosso.
 *
 * Existe porque provedores diferentes relatam o MESMO problema de formas
 * diferentes: a mesma chave inválida vira `AI_APICallError` num, `401
 * Unauthorized` noutro e `authentication_error` num terceiro. Sem normalizar, a
 * tela de execuções mostraria três textos distintos e o operador não saberia
 * que os três são a mesma conversa — "a chave está errada".
 *
 * Os baldes são escolhidos pela AÇÃO que cada um exige de quem instalou:
 * trocar a chave, escolher outro modelo, esperar/pagar, ou aguardar o provedor.
 */
/**
 * Exportada para o diagnóstico da instalação usar a MESMA régua. Sem isto,
 * "por que o funcionário não responde" teria uma classificação própria, e as
 * duas telas dariam nomes diferentes ao mesmo erro do provedor.
 */
export function normalizarErro(err: unknown): {
  error_code: string;
  error_message: string;
  http_status: number | null;
} {
  const bruto = err instanceof Error ? err.message : String(err);
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ??
    (err as { statusCode?: number; status?: number })?.status ??
    null;

  // O único erro deste seam que NÃO vem do provedor: a recusa é NOSSA, e é
  // deliberada. Casada pela CLASSE e não por regex, porque aqui não há três
  // grafias de fornecedor para reconciliar — há um objeto que nós mesmos
  // construímos. Sem este ramo a tela de Execuções mostraria "Não conseguimos
  // classificar esta falha" no caso mais bem explicado do produto.
  if (err instanceof LlmBudgetExceededError) {
    return { error_code: 'orcamento_esgotado', error_message: redigirMensagemDoProvedor(bruto), http_status: null };
  }
  // Também é recusa NOSSA (o prazo do seam), casada pela classe pelo mesmo motivo.
  if (err instanceof LlmTempoEsgotadoError) {
    return { error_code: 'tempo_esgotado', error_message: redigirMensagemDoProvedor(bruto), http_status: null };
  }

  let codigo = 'erro_desconhecido';
  if (status === 401 || status === 403 || /unauthor|invalid.*api.?key|authentication|incorrect api key/i.test(bruto)) {
    codigo = 'credencial_recusada';
  } else if (status === 404 || /model.*not.*found|does not exist/i.test(bruto)) {
    codigo = 'modelo_inexistente';
  } else if (status === 429 || /rate.?limit|quota|insufficient.*credit/i.test(bruto)) {
    codigo = 'limite_ou_saldo';
  } else if ((status !== null && status >= 500) || /timeout|ECONNREFUSED|fetch failed|network/i.test(bruto)) {
    codigo = 'provedor_indisponivel';
  } else if (/tool|function.?call/i.test(bruto)) {
    codigo = 'modelo_sem_ferramentas';
  }

  return {
    error_code: codigo,
    // Redigida E truncada. O comentário anterior dizia "sem
    // prompt/resposta/chave" e o único tratamento era o `slice` — a garantia
    // estava escrita e não existia, que é pior que não existir e ninguém
    // achar que existe.
    //
    // A mensagem crua do provedor vai para `llm_calls.error_message`, sai no
    // JSON de `GET /api/v1/ai/runs` e é renderizada na tela de Execuções para
    // qualquer `manager` da organização. Um endpoint OpenAI-compatível
    // apontado por `base_url` — caminho que o painel de provedores abre — pode
    // ecoar no corpo de erro o header de autorização ou o prompt recebido.
    error_message: redigirMensagemDoProvedor(bruto),
    http_status: typeof status === 'number' ? status : null,
  };
}

/**
 * Tira da mensagem do provedor o que não pode aparecer numa tela: segredo e
 * dado do titular. Trunca DEPOIS de redigir — cortar antes deixaria meia chave
 * passar, e meia chave ainda identifica de quem ela é.
 *
 * Os padrões de chave (`sk-…`, `Bearer …`) vêm daqui e não do
 * `lib/sentry/scrub.ts` porque lá o alvo é PII de titular; os dois se somam.
 */
export function redigirMensagemDoProvedor(bruto: string): string {
  const semSegredo = bruto
    // Chaves de API dos provedores que este produto fala: `sk-ant-…`,
    // `sk-or-v1-…`, `sk-proj-…`, `sk-…`, e as do Google (`AIza…`).
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[CHAVE]')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, '[CHAVE]')
    // O header inteiro, em qualquer caixa, com ou sem `Authorization:` na
    // frente — é assim que ele costuma aparecer ecoado num corpo de erro.
    .replace(/[Bb]earer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [CHAVE]')
    .replace(/(x-api-key|api[-_]?key|authorization)\s*[:=]\s*\S+/gi, '$1: [CHAVE]');
  return scrubMessage(semSegredo).slice(0, 500);
}

/**
 * Grava a chamada que FALHOU, na MESMA tabela do sucesso.
 *
 * Mesma tabela de propósito: a tela de execuções conta a história de um ponto em
 * ordem, e separar erros noutra tabela faria a leitura precisar de dois lugares
 * — que é exatamente como um dos dois para de ser olhado.
 *
 * Tokens ficam em zero e o custo em NULL: a chamada não consumiu nada, e `null`
 * é "não sei", nunca "de graça" — mesma doutrina da coluna `cost_cents`.
 */
async function registrarFalha(
  db: pg.Pool,
  d: {
    input: RunModelCallInput;
    purpose: string;
    provider: string;
    model: string;
    origem: string;
    latencyMs: number;
    erro: unknown;
  },
): Promise<void> {
  const { error_code, error_message, http_status } = normalizarErro(d.erro);
  await db.query(
    `insert into llm_calls
       (organization_id, contact_id, job_id, variant_id, purpose, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents, latency_ms,
        status, error_code, error_message, http_status, origem_da_escolha)
     values ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, null, $8, 'erro', $9, $10, $11, $12)`,
    [
      d.input.tenantId,
      d.input.leadId ?? null,
      d.input.jobId ?? null,
      d.input.variantId ?? null,
      d.purpose,
      d.provider,
      d.model,
      d.latencyMs,
      error_code,
      error_message,
      http_status,
      d.origem,
    ],
  );
}
