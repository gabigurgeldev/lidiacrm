/**
 * O ENSAIO DO AGENTE: o turno de PRODUÇÃO, inteiro, dentro de uma transação
 * que é desfeita no fim.
 *
 * O botão Testar antigo rodava outro motor (`lib/ai/runtime/agent.ts`): outro
 * prompt, nenhuma conferência de envio, texto solto contado como resposta — e
 * as capacidades de escrita mexiam no CRM real. Ele aprovava respostas que em
 * produção nunca sairiam e reprovava as que sairiam.
 *
 * Aqui o turno é o mesmo handler que o worker usa (`createInboundTurnHandler`),
 * com as mesmas dependências (`montarDepsDoTurno`), sobre um cenário montado
 * dentro de um `BEGIN`:
 *
 *  1. o formulário vira uma versão rascunho, lida pela mesma query da produção;
 *  2. contato, conversa e mensagens do teste são criados — só existem na transação;
 *  3. o turno roda; o que ele grava (estado, notas, checkpoint, rastro das
 *     conferências, avisos) é lido ANTES do `ROLLBACK`, para o relatório;
 *  4. `ROLLBACK`. Nada do teste fica no banco.
 *
 * O que escapa da transação e por isso é tratado à parte: o envio (canal de
 * captura), as capacidades do CRM (`capacidades-simuladas.ts`), o espelho de
 * etapa (não roda), integrações externas (só GET sai; o resto é simulado), o
 * e-mail de código (simulado) e a contabilidade da IA — que é REAL e vai por
 * outra conexão (`ContabilidadeSeparada`), porque o custo do teste existe.
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { VersionInput } from '@/lib/ai/agents/validation';

import { loadAgentConfigByVersionId } from '../agent/agent-config';
import type { FollowupTurnDeps } from '../agent/followup-turn';
import { isLeadInHandoff } from '../agent/human-handoff';
import { canalPadraoDoTurno, createInboundTurnHandler, JobSettledError } from '../agent/inbound-turn';
import type { ChannelAdapter, ChannelSendInput } from '../channel-adapter';
import type { JobRow } from '../queue/queue';

import { poolDoEnsaio } from './pool-do-ensaio';

export interface FalaDoEnsaio {
  de: 'cliente' | 'agente';
  texto: string;
}

export interface PedidoDeEnsaio {
  organizationId: string;
  /** Agente que está sendo editado; `null` quando o formulário é de criação. */
  agentId: string | null;
  /** O formulário, já validado por `versionCreateSchema`. */
  versao: VersionInput;
  /** A conversa até aqui; a última fala é do cliente e é a que o turno responde. */
  conversa: FalaDoEnsaio[];
  nomeDoContato?: string;
  /** "Testar como se fosse agora" — fixa o relógio (horário de funcionamento, janela). */
  agora?: Date;
}

export type DesfechoDoEnsaio = 'respondeu' | 'passou_para_humano' | 'adiado' | 'sem_resposta' | 'falhou';

export interface RelatorioDoEnsaio {
  id: string;
  desfecho: DesfechoDoEnsaio;
  /** O que sairia para o cliente, em ordem. Nada foi enviado. */
  mensagens: Array<{ texto: string; template: boolean }>;
  /** Cada ferramenta que o agente chamou, com o que escolheu e o que voltou. */
  ferramentas: Array<{ ferramenta: string; entrada: unknown; resultado: unknown; simulada: boolean }>;
  /** O rastro da cadeia de conferências de cada tentativa de envio. */
  conferencias: Array<{ trace: unknown; barradaPor: string | null; codigo: string | null }>;
  /** Para onde o turno levou o cliente no funil, e o que o agente anotou. */
  estado: { etapa: string | null; proximaAcao: string | null; resumo: string | null; notas: string[] };
  /** Avisos que o turno abriria na Central. */
  avisos: Array<{ kind: string; titulo: string }>;
  /** Por que o turno foi adiado (fora do horário, janela, teto do número). */
  adiamento: { motivo: string; ate: string | null } | null;
  erro: string | null;
  custo: { chamadas: number; centavos: number; tokensDeEntrada: number; tokensDeSaida: number };
  esperasMs: number[];
  duracaoMs: number;
}

export class EnsaioOcupadoError extends Error {
  constructor() {
    super('já há um ensaio rodando nesta organização — espere ele terminar');
    this.name = 'EnsaioOcupadoError';
  }
}

/** Integrações no ensaio: consulta (GET) sai de verdade; o resto é simulado. */
function fetchDoEnsaio(fetchReal: typeof fetch): typeof fetch {
  return (async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const metodo = (init?.method ?? 'GET').toUpperCase();
    if (metodo === 'GET' || metodo === 'HEAD') return fetchReal(entrada, init);
    return new Response(JSON.stringify({ ok: true, simulado: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

/**
 * O canal do ensaio: as LEITURAS (saúde da sessão, capacidades, custo) são as do
 * adaptador real — o teste vê o número como ele está —, e o ENVIO é capturado.
 */
function canalDeCaptura(real: ChannelAdapter, capturadas: ChannelSendInput[]): ChannelAdapter {
  return {
    channel: 'ensaio',
    send: async (input) => {
      capturadas.push(input);
      const chave = `ensaio-${input.jobId}-${input.seq}`;
      return { kind: 'sent', idempotencyKey: chave, messageId: chave };
    },
    sessionHealth: (channelSessionId) => real.sessionHealth(channelSessionId),
    capabilities: () => real.capabilities(),
    costPerMessage: () => real.costPerMessage(),
  };
}

/** Grava o formulário como rascunho dentro da transação. As chaves do schema SÃO as colunas. */
async function gravarVersaoDoFormulario(
  db: pg.Pool,
  organizationId: string,
  agentId: string,
  versao: VersionInput,
): Promise<string> {
  const colunas = Object.entries(versao).filter(([, valor]) => valor !== undefined);
  const nomes = colunas.map(([nome]) => nome);
  const valores = colunas.map(([, valor]) =>
    // jsonb (trigger_config, followup) vai como JSON; arrays viram arrays do Postgres.
    valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? JSON.stringify(valor) : valor,
  );
  const marcadores = nomes.map((_, i) => `$${i + 4}`);
  const { rows } = await db.query<{ id: string }>(
    `insert into ai_agent_versions (organization_id, agent_id, version_number, status, ${nomes.join(', ')})
     values ($1, $2, (select coalesce(max(version_number), 0) + 1 from ai_agent_versions where agent_id = $2), $3,
             ${marcadores.join(', ')})
     returning id`,
    [organizationId, agentId, 'draft', ...valores],
  );
  return rows[0]!.id;
}

export async function ensaiarTurno(
  poolReal: pg.Pool,
  depsBase: FollowupTurnDeps,
  pedido: PedidoDeEnsaio,
): Promise<RelatorioDoEnsaio> {
  const id = randomUUID();
  const inicio = Date.now();
  const ultima = pedido.conversa.at(-1);
  if (ultima === undefined || ultima.de !== 'cliente') {
    throw new Error('o ensaio precisa terminar numa fala do cliente');
  }

  const capturadas: ChannelSendInput[] = [];
  const ferramentas: RelatorioDoEnsaio['ferramentas'] = [];
  const custo = { chamadas: 0, centavos: 0, tokensDeEntrada: 0, tokensDeSaida: 0 };
  const esperasMs: number[] = [];

  const cliente = await poolReal.connect();
  try {
    await cliente.query('begin');
    // Prazos da transação inteira: um ensaio pendurado não pode segurar conexão.
    await cliente.query("set local idle_in_transaction_session_timeout = '180s'");
    await cliente.query("set local statement_timeout = '60s'");
    const { rows: vez } = await cliente.query<{ ok: boolean }>(
      'select pg_try_advisory_xact_lock(hashtext($1)) as ok',
      [`ensaio-da-org:${pedido.organizationId}`],
    );
    if (vez[0]?.ok !== true) throw new EnsaioOcupadoError();

    const fachada = poolDoEnsaio(cliente, id);
    const db = fachada.pool;
    const org = pedido.organizationId;

    // 1. O agente e a versão do formulário.
    let agentId = pedido.agentId;
    if (agentId === null) {
      const { rows } = await db.query<{ id: string }>(
        `insert into ai_agents (organization_id, name, system_prompt, model, kind, is_active, is_default)
         values ($1, $2, $3, $4, 'mcp_agent', false, false) returning id`,
        [org, `Ensaio ${id.slice(0, 8)}`, pedido.versao.system_prompt, pedido.versao.model],
      );
      agentId = rows[0]!.id;
    }
    const versionId = await gravarVersaoDoFormulario(db, org, agentId, pedido.versao);
    const agente = await loadAgentConfigByVersionId(db, org, versionId);
    if (agente === null) throw new Error('ensaio: a versão do formulário não pôde ser lida');

    // 2. O cliente do teste e a conversa.
    const telefone = `+5500${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const { rows: contato } = await db.query<{ id: string }>(
      `insert into contacts (organization_id, name, phone_number) values ($1, $2, $3) returning id`,
      [org, pedido.nomeDoContato?.trim() || 'Cliente do teste', telefone],
    );
    const contactId = contato[0]!.id;
    const channelSessionId = pedido.versao.channel_session_id;
    const { rows: conversa } = await db.query<{ id: string }>(
      `insert into conversations (organization_id, contact_id, channel_session_id, status, is_group)
       values ($1, $2, $3, 'ai_handling', false) returning id`,
      [org, contactId, channelSessionId],
    );
    const conversationId = conversa[0]!.id;
    const agora = pedido.agora ?? new Date();
    let ultimaMensagemId = '';
    for (const [i, fala] of pedido.conversa.entries()) {
      const enviadaEm = new Date(agora.getTime() - (pedido.conversa.length - i) * 30_000);
      const { rows } = await db.query<{ id: string }>(
        `insert into messages (organization_id, conversation_id, channel_session_id, contact_id,
           type, direction, status, body, sent_via, sent_at)
         values ($1, $2, $3, $4, 'text', $5, $6, $7, $8, $9) returning id`,
        [
          org,
          conversationId,
          channelSessionId,
          contactId,
          fala.de === 'cliente' ? 'inbound' : 'outbound',
          fala.de === 'cliente' ? 'delivered' : 'sent',
          fala.texto,
          fala.de === 'cliente' ? 'external_device' : 'ai',
          enviadaEm,
        ],
      );
      ultimaMensagemId = rows[0]!.id;
    }

    // 3. O job do turno, já "claimado" pelo ensaio.
    const { rows: jobs } = await db.query<JobRow>(
      `insert into job_queue (organization_id, contact_id, kind, payload, status, locked_by, locked_at, attempts, max_attempts)
       values ($1, $2, 'inbound_turn', $3, 'running', $4, now(), 1, 1) returning *`,
      [
        org,
        contactId,
        JSON.stringify({
          conversation_id: conversationId,
          contact_id: contactId,
          channel_session_id: channelSessionId,
          inbound_message_id: ultimaMensagemId,
          crm_event_id: id,
        }),
        `ensaio:${id}`,
      ],
    );
    const job = jobs[0]!;

    // 4. O turno de produção, com os efeitos externos trocados.
    const deps: FollowupTurnDeps = {
      ...depsBase,
      llmCfg: {
        ...depsBase.llmCfg,
        contabilidade: {
          db: poolReal,
          prefixoDoProposito: 'ensaio:',
          aoRegistrar: (c) => {
            custo.chamadas += 1;
            custo.centavos += c.costCents ?? 0;
            custo.tokensDeEntrada += c.inputTokens;
            custo.tokensDeSaida += c.outputTokens;
          },
        },
      },
      channel: (p) => canalDeCaptura(canalPadraoDoTurno(p, depsBase.crmCfg), capturadas),
      clock: () => pedido.agora ?? new Date(),
      sleep: async (ms) => {
        esperasMs.push(ms);
      },
      integracoes: {
        ...depsBase.integracoes,
        fetchImpl: fetchDoEnsaio(depsBase.integracoes?.fetchImpl ?? fetch),
        enviarEmail: async () => ({ ok: true }),
        emailConfigurado: () => true,
      },
      ensaio: {
        id,
        agente,
        aoChamarFerramenta: (c) => {
          const simulada =
            typeof c.resultado === 'object' && c.resultado !== null && (c.resultado as { simulado?: unknown }).simulado === true;
          ferramentas.push({ ...c, simulada });
        },
      },
    };

    // O turno roda dentro de um savepoint próprio: um erro de SQL lá dentro
    // aborta a transação, e sem o savepoint as leituras do relatório abaixo
    // falhariam todas com "current transaction is aborted" — o dono veria
    // "falhou" sem saber o quê.
    let erro: string | null = null;
    let adiado = false;
    await cliente.query('savepoint ensaio_turno');
    try {
      await createInboundTurnHandler(deps)(job, db, { workerId: `ensaio:${id}` });
      await cliente.query('release savepoint ensaio_turno');
    } catch (err) {
      if (err instanceof JobSettledError) {
        adiado = true;
        await cliente.query('release savepoint ensaio_turno');
      } else {
        erro = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
        await cliente.query('rollback to savepoint ensaio_turno');
      }
    }

    // 5. O que o turno deixou, lido antes de desfazer.
    const { rows: traces } = await db.query<{ trace: unknown; vetoed_gate: string | null; vetoed_code: string | null }>(
      `select trace, vetoed_gate, vetoed_code from before_send_traces where job_id = $1 order by created_at, id`,
      [job.id],
    );
    const { rows: estado } = await db.query<{ stage: string | null; next_action: string | null }>(
      `select stage, next_action from lead_state where organization_id = $1 and contact_id = $2`,
      [org, contactId],
    );
    const { rows: checkpoint } = await db.query<{ linha: Record<string, unknown> }>(
      `select to_jsonb(c) as linha from lead_checkpoints c
        where organization_id = $1 and contact_id = $2 order by seq desc limit 1`,
      [org, contactId],
    );
    const { rows: notas } = await db.query<{ headline: string }>(
      `select headline from lead_notes where organization_id = $1 and contact_id = $2 order by created_at`,
      [org, contactId],
    );
    // `now()` é o instante do BEGIN: as linhas com created_at igual a ele nasceram
    // nesta transação — avisos abertos pelo turno, e só eles.
    const { rows: avisos } = await db.query<{ kind: string; title: string }>(
      `select kind, title from agent_inbox_items where organization_id = $1 and created_at = now() order by id`,
      [org],
    );
    const { rows: jobDepois } = await db.query<{ status: string; run_after: Date; last_error: string | null }>(
      `select status, run_after, last_error from job_queue where id = $1`,
      [job.id],
    );
    const passouParaHumano = await isLeadInHandoff(db, org, contactId);

    await cliente.query('rollback');

    const linhaDoCheckpoint = checkpoint[0]?.linha ?? null;
    const resumo =
      linhaDoCheckpoint === null
        ? null
        : String(
            (linhaDoCheckpoint.rolling_summary as string | undefined) ??
              ((linhaDoCheckpoint.content as Record<string, unknown> | undefined)?.rolling_summary as string | undefined) ??
              '',
          ) || null;

    const depois = jobDepois[0];
    const desfecho: DesfechoDoEnsaio =
      erro !== null
        ? 'falhou'
        : adiado
          ? 'adiado'
          : capturadas.length > 0
            ? 'respondeu'
            : passouParaHumano
              ? 'passou_para_humano'
              : 'sem_resposta';

    return {
      id,
      desfecho,
      mensagens: capturadas.map((c) => ({ texto: c.body, template: c.template !== undefined })),
      ferramentas,
      conferencias: traces.map((t) => ({ trace: t.trace, barradaPor: t.vetoed_gate, codigo: t.vetoed_code })),
      estado: {
        etapa: estado[0]?.stage ?? null,
        proximaAcao: estado[0]?.next_action ?? null,
        resumo,
        notas: notas.map((n) => n.headline),
      },
      avisos: avisos.map((a) => ({ kind: a.kind, titulo: a.title })),
      adiamento:
        adiado && depois !== undefined
          ? { motivo: depois.last_error ?? 'turno adiado', ate: depois.status === 'pending' ? depois.run_after.toISOString() : null }
          : null,
      erro,
      custo,
      esperasMs,
      duracaoMs: Date.now() - inicio,
    };
  } catch (err) {
    await cliente.query('rollback').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
