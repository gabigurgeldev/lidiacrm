/**
 * Integrações via API no worker — o acesso ao banco (pg, service role).
 *
 * O worker roda FORA da RLS. Toda query aqui filtra `organization_id = tenantId`
 * com o tenant vindo da ROW do job — nunca do modelo, nunca do payload
 * (anti-pattern 10). É o que impede um endpoint de outra organização de ser
 * carregado mesmo que um id dele apareça na versão do agente por corrupção.
 */
import { randomUUID } from 'node:crypto';


import {
  lerContas,
  lerSelecionadas,
  type AuthTipo,
  type ContaEncontrada,
  type Metodo,
  type ModoDeEndpoint,
  type Selecionadas,
} from '@/lib/ai/integracoes/schema';
import type { RespostaDaChamada } from '@/lib/ai/integracoes/cliente-http';
import { byteaToBuffer, decryptKey, encryptKey } from '@/lib/crypto/aes_gcm';

import { insertInboxItem } from '../../db/repository';
import type { Queryable } from '../../queue/queue';

export type IntegracaoCarregada = {
  id: string;
  nome: string;
  /** Prefixo dos endpoints no catálogo que o modelo vê: `gestalt_crm`. */
  chave: string;
  tipo: 'generica' | 'suporte_v1';
  base_url: string;
  auth_tipo: AuthTipo;
  auth_header_nome: string | null;
  identidade_modo: 'nenhuma' | 'email_otp';
  identidade_endpoint_id: string | null;
  sessao_horas: number;
  circuito_aberto_ate: Date | null;
  segredo: string | null;
};

export type EndpointCarregado = {
  id: string;
  integration_id: string;
  slug: string;
  titulo: string;
  descricao_para_ia: string;
  metodo: Metodo;
  caminho: string;
  parametros: unknown;
  corpo_fixo: Record<string, unknown> | null;
  modo: ModoDeEndpoint;
  exige_identidade: boolean;
  texto_de_confirmacao: string | null;
  campos_da_resposta: string[];
  timeout_ms: number;
};

export function chaveDaIntegracao(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return base.length > 0 ? base : 'sistema';
}

function lerSegredo(row: { segredo_encrypted: unknown; segredo_iv: unknown; segredo_tag: unknown } | undefined): string | null {
  if (!row || row.segredo_encrypted == null) return null;
  try {
    return decryptKey({
      ciphertext: byteaToBuffer(row.segredo_encrypted),
      iv: byteaToBuffer(row.segredo_iv),
      tag: byteaToBuffer(row.segredo_tag),
    });
  } catch {
    // Chave da instalação trocada ou linha corrompida: a integração fica sem
    // segredo e cada chamada devolve `sem_segredo` — visível na tela.
    return null;
  }
}

/**
 * Carrega o que a versão do agente ligou: endpoints ativos de integrações
 * ativas e não arquivadas, DESTA organização. Junta também o endpoint de
 * identidade de cada integração com `email_otp`, mesmo que a tela não o tenha
 * marcado — sem ele, a verificação não tem a quem perguntar.
 */
export async function carregarDoAgente(
  db: Queryable,
  tenantId: string,
  endpointIds: readonly string[],
): Promise<{ integracoes: Map<string, IntegracaoCarregada>; endpoints: EndpointCarregado[]; ausentes: number }> {
  const integracoes = new Map<string, IntegracaoCarregada>();
  if (endpointIds.length === 0) return { integracoes, endpoints: [], ausentes: 0 };

  const { rows: eps } = await db.query<EndpointCarregado & { ativo_integracao: boolean }>(
    `select e.id, e.integration_id, e.slug, e.titulo, e.descricao_para_ia, e.metodo, e.caminho,
            e.parametros, e.corpo_fixo, e.modo, e.exige_identidade, e.texto_de_confirmacao,
            e.campos_da_resposta, e.timeout_ms
       from ai_api_endpoints e
       join ai_api_integrations i on i.id = e.integration_id and i.organization_id = e.organization_id
      where e.organization_id = $1
        and e.id = any($2::uuid[])
        and e.ativo
        and i.ativo
        and i.arquivada_em is null`,
    [tenantId, endpointIds],
  );
  const ausentes = endpointIds.length - eps.length;
  const integracaoIds = [...new Set(eps.map((e) => e.integration_id))];
  if (integracaoIds.length === 0) return { integracoes, endpoints: [], ausentes };

  const { rows: ints } = await db.query<
    Omit<IntegracaoCarregada, 'chave' | 'segredo'> & {
      segredo_encrypted: unknown;
      segredo_iv: unknown;
      segredo_tag: unknown;
    }
  >(
    `select i.id, i.nome, i.tipo, i.base_url, i.auth_tipo, i.auth_header_nome, i.identidade_modo,
            i.identidade_endpoint_id, i.sessao_horas, i.circuito_aberto_ate,
            s.segredo_encrypted, s.segredo_iv, s.segredo_tag
       from ai_api_integrations i
       left join ai_api_integration_secrets s
         on s.integration_id = i.id and s.organization_id = i.organization_id
      where i.organization_id = $1 and i.id = any($2::uuid[])
      order by i.created_at, i.id`,
    [tenantId, integracaoIds],
  );
  const chavesUsadas = new Set<string>();
  for (const r of ints) {
    let chave = chaveDaIntegracao(r.nome);
    let n = 2;
    while (chavesUsadas.has(chave)) chave = `${chaveDaIntegracao(r.nome)}_${n++}`;
    chavesUsadas.add(chave);
    integracoes.set(r.id, {
      id: r.id,
      nome: r.nome,
      chave,
      tipo: r.tipo,
      base_url: r.base_url,
      auth_tipo: r.auth_tipo,
      auth_header_nome: r.auth_header_nome,
      identidade_modo: r.identidade_modo,
      identidade_endpoint_id: r.identidade_endpoint_id,
      sessao_horas: r.sessao_horas,
      circuito_aberto_ate: r.circuito_aberto_ate,
      segredo: lerSegredo(r),
    });
  }

  // O endpoint de identidade entra mesmo sem estar marcado na versão.
  const faltandoIdentidade = [...integracoes.values()]
    .filter((i) => i.identidade_modo === 'email_otp' && i.identidade_endpoint_id)
    .map((i) => i.identidade_endpoint_id as string)
    .filter((id) => !eps.some((e) => e.id === id));
  if (faltandoIdentidade.length > 0) {
    const { rows: extras } = await db.query<EndpointCarregado>(
      `select id, integration_id, slug, titulo, descricao_para_ia, metodo, caminho, parametros,
              corpo_fixo, modo, exige_identidade, texto_de_confirmacao, campos_da_resposta, timeout_ms
         from ai_api_endpoints
        where organization_id = $1 and id = any($2::uuid[]) and ativo`,
      [tenantId, faltandoIdentidade],
    );
    eps.push(...extras.map((e) => ({ ...e, ativo_integracao: true })));
  }

  return { integracoes, endpoints: eps, ausentes };
}

// ─────────────────────────── log + circuito ───────────────────────────

/** Respostas de NEGÓCIO (o sistema respondeu, e respondeu "não"): não contam como falha do sistema. */
const STATUS_DE_NEGOCIO = new Set([400, 403, 404, 409, 422]);

export const FALHAS_PARA_ABRIR_O_CIRCUITO = 5;
export const CIRCUITO_ABERTO_MS = 10 * 60 * 1000;

export async function registrarChamada(
  db: Queryable,
  tenantId: string,
  input: {
    integracao: Pick<IntegracaoCarregada, 'id' | 'nome'>;
    endpointId: string | null;
    conversationId: string | null;
    origem: 'agente' | 'verificacao' | 'acao';
    resposta: RespostaDaChamada;
  },
): Promise<void> {
  const r = input.resposta;
  await db.query(
    `insert into ai_api_chamadas
       (organization_id, integration_id, endpoint_id, conversation_id, origem, http_status, ok, erro_codigo, duracao_ms, bytes_resposta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tenantId,
      input.integracao.id,
      input.endpointId,
      input.conversationId,
      input.origem,
      r.http_status,
      r.ok,
      r.erro_codigo,
      r.duracao_ms,
      r.bytes_resposta,
    ],
  );

  const falhaDoSistema = !r.ok && !(r.http_status !== null && STATUS_DE_NEGOCIO.has(r.http_status));
  if (!falhaDoSistema) {
    await db.query(
      `update ai_api_integrations set falhas_consecutivas = 0, circuito_aberto_ate = null
        where organization_id = $1 and id = $2 and (falhas_consecutivas <> 0 or circuito_aberto_ate is not null)`,
      [tenantId, input.integracao.id],
    );
    return;
  }

  const { rows } = await db.query<{ falhas_consecutivas: number; abriu: boolean }>(
    `update ai_api_integrations
        set falhas_consecutivas = falhas_consecutivas + 1,
            circuito_aberto_ate = case when falhas_consecutivas + 1 >= $3
                                       then now() + ($4::int * interval '1 millisecond')
                                       else circuito_aberto_ate end
      where organization_id = $1 and id = $2
      returning falhas_consecutivas, (falhas_consecutivas = $3) as abriu`,
    [tenantId, input.integracao.id, FALHAS_PARA_ABRIR_O_CIRCUITO, CIRCUITO_ABERTO_MS],
  );
  if (rows[0]?.abriu) {
    await insertInboxItem(
      db,
      tenantId,
      {
        kind: 'integracao_api_falhando',
        severity: 'warn',
        title: `A integração "${input.integracao.nome}" está falhando`,
        body:
          `${FALHAS_PARA_ABRIR_O_CIRCUITO} chamadas seguidas falharam (último erro: ${r.erro_codigo ?? 'desconhecido'}). ` +
          'O agente parou de consultá-la por 10 minutos e, enquanto isso, transfere quem precisar dela para a equipe. ' +
          'Abra Central de IA › Integrações via API e use "Testar conexão".',
        refKind: 'ai_api_integration',
        refId: input.integracao.id,
      },
      'kind_e_ref',
    );
  }
}

// ─────────────────────────── auditoria ───────────────────────────

export async function auditar(
  db: Queryable,
  tenantId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.query(
      `insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
       values ($1, $2, null, $3, $4, $5, true)`,
      [tenantId, action, resourceType, resourceId, JSON.stringify({ ...metadata, via: 'agente' })],
    );
  } catch {
    // Auditoria não bloqueia a mutação principal (doutrina de audit log).
  }
}

// ─────────────────────────── verificação ───────────────────────────

export type SessaoVerificada = {
  id: string;
  emailMascarado: string;
  email: string | null;
  validoAte: Date;
  contas: ContaEncontrada[];
  selecionadas: Selecionadas;
};

export type DesafioPendente = {
  id: string;
  emailMascarado: string;
  codigoHash: string | null;
  tentativas: number;
  codigoExpiraEm: Date;
  criadoEm: Date;
  ultimaMensagemTentadaId: string | null;
  contas: ContaEncontrada[];
};

type LinhaDeVerificacao = {
  id: string;
  status: string;
  email_mascarado: string;
  email_encrypted: unknown;
  email_iv: unknown;
  email_tag: unknown;
  codigo_hash: string | null;
  tentativas: number;
  codigo_expira_em: Date;
  valido_ate: Date | null;
  created_at: Date;
  ultima_mensagem_tentada_id: string | null;
  contas: unknown;
  selecionadas: unknown;
};

function emailDaLinha(r: LinhaDeVerificacao): string | null {
  if (r.email_encrypted == null) return null;
  try {
    return decryptKey({
      ciphertext: byteaToBuffer(r.email_encrypted),
      iv: byteaToBuffer(r.email_iv),
      tag: byteaToBuffer(r.email_tag),
    });
  } catch {
    return null;
  }
}

async function ultimaVerificacao(db: Queryable, tenantId: string, conversationId: string): Promise<LinhaDeVerificacao | null> {
  const { rows } = await db.query<LinhaDeVerificacao>(
    `select id, status, email_mascarado, email_encrypted, email_iv, email_tag, codigo_hash, tentativas,
            codigo_expira_em, valido_ate, created_at, ultima_mensagem_tentada_id, contas, selecionadas
       from ai_api_verificacoes
      where organization_id = $1 and conversation_id = $2
      order by created_at desc, id desc
      limit 1`,
    [tenantId, conversationId],
  );
  return rows[0] ?? null;
}

/** A verificação válida da conversa, se houver. */
export async function sessaoDaConversa(
  db: Queryable,
  tenantId: string,
  conversationId: string,
  agora: Date,
): Promise<SessaoVerificada | null> {
  const r = await ultimaVerificacao(db, tenantId, conversationId);
  if (!r || r.status !== 'verificado' || !r.valido_ate || r.valido_ate.getTime() <= agora.getTime()) return null;
  return {
    id: r.id,
    emailMascarado: r.email_mascarado,
    email: emailDaLinha(r),
    validoAte: r.valido_ate,
    contas: lerContas(r.contas),
    selecionadas: lerSelecionadas(r.selecionadas),
  };
}

export async function desafioDaConversa(
  db: Queryable,
  tenantId: string,
  conversationId: string,
): Promise<DesafioPendente | null> {
  const r = await ultimaVerificacao(db, tenantId, conversationId);
  if (!r || r.status !== 'pendente') return null;
  return {
    id: r.id,
    emailMascarado: r.email_mascarado,
    codigoHash: r.codigo_hash,
    tentativas: r.tentativas,
    codigoExpiraEm: r.codigo_expira_em,
    criadoEm: r.created_at,
    ultimaMensagemTentadaId: r.ultima_mensagem_tentada_id,
    contas: lerContas(r.contas),
  };
}

export async function contagensRecentes(
  db: Queryable,
  tenantId: string,
  conversationId: string,
  emailHash: string,
): Promise<{ conversaUltimaHora: number; emailUltimoDia: number; organizacaoUltimaHora: number }> {
  const { rows } = await db.query<{ conversa: string; email: string; org: string }>(
    `select
       count(*) filter (where conversation_id = $2 and created_at > now() - interval '1 hour') as conversa,
       count(*) filter (where email_hash = $3 and created_at > now() - interval '1 day') as email,
       count(*) filter (where created_at > now() - interval '1 hour') as org
     from ai_api_verificacoes
     where organization_id = $1 and created_at > now() - interval '1 day'`,
    [tenantId, conversationId, emailHash],
  );
  const r = rows[0];
  return {
    conversaUltimaHora: Number(r?.conversa ?? 0),
    emailUltimoDia: Number(r?.email ?? 0),
    organizacaoUltimaHora: Number(r?.org ?? 0),
  };
}

/** Cria o desafio, substituindo os pendentes anteriores da conversa. */
export async function criarDesafio(
  db: Queryable,
  input: {
    id?: string;
    tenantId: string;
    conversationId: string;
    contactId: string;
    email: string;
    emailHash: string;
    emailMascarado: string;
    codigoHash: string | null;
    expiraEm: Date;
    /** Relógio do TURNO, não o do banco: o código digitado é comparado com ele. */
    criadoEm: Date;
    contas: ContaEncontrada[];
  },
): Promise<string> {
  const id = input.id ?? randomUUID();
  await db.query(
    `update ai_api_verificacoes set status = 'substituido'
      where organization_id = $1 and conversation_id = $2 and status = 'pendente'`,
    [input.tenantId, input.conversationId],
  );
  const cifrado = encryptKey(input.email);
  await db.query(
    `insert into ai_api_verificacoes
       (id, organization_id, conversation_id, contact_id, email_hash, email_mascarado,
        email_encrypted, email_iv, email_tag, codigo_hash, codigo_expira_em, contas, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.tenantId,
      input.conversationId,
      input.contactId,
      input.emailHash,
      input.emailMascarado,
      cifrado.ciphertext,
      cifrado.iv,
      cifrado.tag,
      input.codigoHash,
      input.expiraEm,
      JSON.stringify(input.contas),
      input.criadoEm,
    ],
  );
  return id;
}

export type MensagemInbound = {
  id: string;
  body: string | null;
  type: string;
  media_storage_path: string | null;
  created_at: Date;
};

/** Mensagens do CLIENTE nesta conversa depois de um instante (no máximo 10). */
export async function inboundsDepoisDe(
  db: Queryable,
  tenantId: string,
  conversationId: string,
  contactId: string,
  depoisDe: Date,
): Promise<MensagemInbound[]> {
  const { rows } = await db.query<MensagemInbound>(
    `select id, body, type, media_storage_path, created_at
       from messages
      where organization_id = $1 and conversation_id = $2 and contact_id = $3
        and direction = 'inbound' and created_at > $4
      order by created_at asc, id asc
      limit 10`,
    [tenantId, conversationId, contactId, depoisDe],
  );
  return rows;
}

export async function instanteDaMensagem(db: Queryable, tenantId: string, messageId: string): Promise<Date | null> {
  const { rows } = await db.query<{ created_at: Date }>(
    `select created_at from messages where organization_id = $1 and id = $2`,
    [tenantId, messageId],
  );
  return rows[0]?.created_at ?? null;
}

export async function registrarTentativa(
  db: Queryable,
  tenantId: string,
  verificacaoId: string,
  mensagemId: string,
): Promise<number> {
  const { rows } = await db.query<{ tentativas: number }>(
    `update ai_api_verificacoes
        set tentativas = tentativas + 1, ultima_mensagem_tentada_id = $3
      where organization_id = $1 and id = $2 and status = 'pendente'
      returning tentativas`,
    [tenantId, verificacaoId, mensagemId],
  );
  return rows[0]?.tentativas ?? 0;
}

export async function marcarVerificacao(
  db: Queryable,
  tenantId: string,
  verificacaoId: string,
  status: 'verificado' | 'bloqueado' | 'expirado',
  extra: { validoAte?: Date; selecionadas?: Selecionadas } = {},
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update ai_api_verificacoes
        set status = $3,
            verificado_em = case when $3 = 'verificado' then now() else verificado_em end,
            valido_ate = coalesce($4, valido_ate),
            selecionadas = coalesce($5::jsonb, selecionadas),
            codigo_hash = null
      where organization_id = $1 and id = $2 and status = 'pendente'`,
    [
      tenantId,
      verificacaoId,
      status,
      extra.validoAte ?? null,
      extra.selecionadas ? JSON.stringify(extra.selecionadas) : null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export async function gravarSelecionadas(
  db: Queryable,
  tenantId: string,
  verificacaoId: string,
  selecionadas: Selecionadas,
): Promise<void> {
  await db.query(
    `update ai_api_verificacoes set selecionadas = $3::jsonb
      where organization_id = $1 and id = $2 and status = 'verificado'`,
    [tenantId, verificacaoId, JSON.stringify(selecionadas)],
  );
}

// ─────────────────────────── ações pendentes ───────────────────────────

export type AcaoPendente = {
  id: string;
  endpoint_id: string;
  verificacao_id: string | null;
  subject_id: string | null;
  params_congelados: Record<string, string | number | boolean>;
  resumo: string;
  status: string;
  oferta_enviada_em: Date | null;
  expira_em: Date;
};

export async function acaoAguardando(db: Queryable, tenantId: string, conversationId: string): Promise<AcaoPendente | null> {
  const { rows } = await db.query<AcaoPendente>(
    `select id, endpoint_id, verificacao_id, subject_id, params_congelados, resumo, status, oferta_enviada_em, expira_em
       from ai_api_acoes_pendentes
      where organization_id = $1 and conversation_id = $2 and status = 'aguardando'
      limit 1`,
    [tenantId, conversationId],
  );
  return rows[0] ?? null;
}

export async function criarAcaoPendente(
  db: Queryable,
  input: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    endpointId: string;
    agentId: string | null;
    verificacaoId: string | null;
    subjectId: string | null;
    params: Record<string, string | number | boolean>;
    resumo: string;
    expiraEm: Date;
  },
): Promise<string> {
  await db.query(
    `update ai_api_acoes_pendentes set status = 'cancelada', erro_codigo = 'substituida', updated_at = now()
      where organization_id = $1 and conversation_id = $2 and status = 'aguardando'`,
    [input.tenantId, input.conversationId],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into ai_api_acoes_pendentes
       (organization_id, conversation_id, contact_id, endpoint_id, agent_id, verificacao_id, subject_id,
        params_congelados, resumo, expira_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      input.tenantId,
      input.conversationId,
      input.contactId,
      input.endpointId,
      input.agentId,
      input.verificacaoId,
      input.subjectId,
      JSON.stringify(input.params),
      input.resumo,
      input.expiraEm,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('ai_api_acoes_pendentes: insert sem id');
  return id;
}

export async function marcarOfertaEnviada(
  db: Queryable,
  tenantId: string,
  acaoId: string,
  messageId: string | null,
  quando: Date,
): Promise<void> {
  // O instante vem do relógio do TURNO: o SIM do cliente é comparado com ele.
  await db.query(
    `update ai_api_acoes_pendentes set oferta_message_id = $3, oferta_enviada_em = $4, updated_at = now()
      where organization_id = $1 and id = $2`,
    [tenantId, acaoId, messageId, quando],
  );
}

export async function encerrarAcao(
  db: Queryable,
  tenantId: string,
  acaoId: string,
  de: 'aguardando' | 'executando',
  para: 'executada' | 'falhou' | 'cancelada' | 'expirada',
  extra: { resultado?: string | null; erroCodigo?: string | null; mensagemId?: string | null } = {},
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update ai_api_acoes_pendentes
        set status = $4, resultado = coalesce($5, resultado), erro_codigo = coalesce($6, erro_codigo),
            confirmada_por_message_id = coalesce($7, confirmada_por_message_id), updated_at = now()
      where organization_id = $1 and id = $2 and status = $3`,
    [tenantId, acaoId, de, para, extra.resultado ?? null, extra.erroCodigo ?? null, extra.mensagemId ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * O CLAIM ATÔMICO. Duas execuções do mesmo job (retry) chegam aqui com a mesma
 * ação; só uma muda `aguardando → executando`. A outra recebe null e não chama
 * o sistema externo de novo.
 */
export async function reivindicarAcao(
  db: Queryable,
  tenantId: string,
  acaoId: string,
  mensagemId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update ai_api_acoes_pendentes
        set status = 'executando', confirmada_por_message_id = $3, updated_at = now()
      where organization_id = $1 and id = $2 and status = 'aguardando'`,
    [tenantId, acaoId, mensagemId],
  );
  return (rowCount ?? 0) > 0;
}

export async function emailDaVerificacao(db: Queryable, tenantId: string, verificacaoId: string): Promise<string | null> {
  const { rows } = await db.query<LinhaDeVerificacao>(
    `select id, status, email_mascarado, email_encrypted, email_iv, email_tag, codigo_hash, tentativas,
            codigo_expira_em, valido_ate, created_at, ultima_mensagem_tentada_id, contas, selecionadas
       from ai_api_verificacoes where organization_id = $1 and id = $2`,
    [tenantId, verificacaoId],
  );
  return rows[0] ? emailDaLinha(rows[0]) : null;
}

export async function telefoneDoContato(db: Queryable, tenantId: string, contactId: string): Promise<string | null> {
  const { rows } = await db.query<{ phone_number: string | null }>(
    `select phone_number from contacts where organization_id = $1 and id = $2`,
    [tenantId, contactId],
  );
  return rows[0]?.phone_number ?? null;
}
