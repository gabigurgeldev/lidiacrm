/**
 * "Só responder quando a mensagem falar de algo específico" — a regra que a
 * tela oferecia e ninguém lia.
 *
 * ## O defeito
 *
 * `TriggerEditor.tsx` grava o filtro em
 * `ai_agent_versions.trigger_config.filters.keyword_regex`. O único leitor era
 * `lib/ai/dispatcher/triggers.ts` — o dispatcher legado, NO-OP permanente. O
 * motor vivo nunca leu o campo: o agente com "só responder sobre pedido"
 * respondia a "bom dia", e dois agentes no mesmo número nunca dividiam o
 * trabalho — atendia sempre o de maior prioridade.
 *
 * ## A regra (só sem roteador e sem coordenador)
 *
 * Os candidatos são TODOS os agentes publicados no número, por prioridade.
 *
 *  1. Conversa em andamento com um deles (ele é o `active_ai_agent_id` e a
 *     conversa teve resposta nas últimas 24 h) ⇒ ele segue, com ou sem filtro.
 *     Sem isso, o filtro cortaria a conversa no meio: o cliente pergunta do
 *     pedido, o agente responde, o cliente diz "pode ser terça?" — e ficaria
 *     sem resposta porque "terça" não fala de pedido.
 *  2. Senão, o primeiro cujo filtro casa com o assunto. Sem filtro = casa.
 *  3. Ninguém casa ⇒ ninguém responde. É o que o dono pediu ao preencher o
 *     filtro; a conversa segue na Inbox para a equipe.
 *
 * Com roteador ou coordenador no número, quem escolhe são eles e o filtro não
 * vale — a tela avisa no agente que é membro de roteador.
 *
 * ## O assunto
 *
 * Toda a rajada desde a última resposta (o cliente escreve em três mensagens
 * curtas), sem acento, em minúsculas, até `LIMITE_DO_ASSUNTO`. O padrão também
 * perde os acentos: quem escreve "preço" no filtro casa com "preco".
 *
 * ## Falha ABERTA
 *
 * Padrão salvo antes da validação que hoje o recusaria (inválido, longo,
 * aninhado) vale como "sem filtro"; assunto vazio (só áudio, só foto) também
 * passa. Config quebrada não pode virar mordaça — mesma direção de
 * `janela-de-atendimento.ts`.
 */

import { compilarSeguro, LIMITE_DO_ASSUNTO } from '@/lib/regex/segura';

/** Quanto tempo sem resposta encerra o "em andamento" (a janela do WhatsApp). */
export const CONVERSA_EM_ANDAMENTO_MS = 24 * 60 * 60 * 1000;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Junta a rajada do cliente num assunto comparável. `null` = nada legível. */
export function montarAssunto(corpos: ReadonlyArray<string | null>): string | null {
  const texto = corpos
    .map((c) => (c ?? '').trim())
    .filter((c) => c !== '')
    .join('\n');
  if (texto === '') return null;
  return semAcento(texto).toLowerCase().slice(0, LIMITE_DO_ASSUNTO);
}

/** O filtro gravado na versão, ou `null` quando não há (ou não é texto). */
export function lerFiltroDeAssunto(triggerConfig: unknown): string | null {
  if (typeof triggerConfig !== 'object' || triggerConfig === null) return null;
  const filters = (triggerConfig as { filters?: unknown }).filters;
  if (typeof filters !== 'object' || filters === null) return null;
  const re = (filters as { keyword_regex?: unknown }).keyword_regex;
  return typeof re === 'string' && re.trim() !== '' ? re : null;
}

/** O assunto passa pelo filtro? Sem filtro, filtro inutilizável ou assunto vazio: passa. */
export function passaNoFiltro(filtro: string | null, assunto: string | null): boolean {
  if (filtro === null || assunto === null) return true;
  const re = compilarSeguro(semAcento(filtro), 'iu');
  if (re === null) return true;
  return re.test(assunto);
}

export interface CandidatoDoAssunto {
  agentId: string;
  filtroDeAssunto: string | null;
}

export type EscolhaPorAssunto<C> =
  | { escolhido: C; motivo: 'em_andamento' | 'filtro' | 'sem_filtro' }
  | { escolhido: null; motivo: 'sem_candidato' | 'fora_do_assunto' };

/**
 * Candidatos já vêm em ordem de prioridade. `emAndamentoCom` é o agente da
 * conversa em andamento (ou `null`).
 */
export function escolherPorAssunto<C extends CandidatoDoAssunto>(
  candidatos: readonly C[],
  input: { assunto: string | null; emAndamentoCom: string | null },
): EscolhaPorAssunto<C> {
  if (candidatos.length === 0) return { escolhido: null, motivo: 'sem_candidato' };
  if (input.emAndamentoCom !== null) {
    const engajado = candidatos.find((c) => c.agentId === input.emAndamentoCom);
    if (engajado !== undefined) return { escolhido: engajado, motivo: 'em_andamento' };
  }
  for (const c of candidatos) {
    if (passaNoFiltro(c.filtroDeAssunto, input.assunto)) {
      return { escolhido: c, motivo: c.filtroDeAssunto === null ? 'sem_filtro' : 'filtro' };
    }
  }
  return { escolhido: null, motivo: 'fora_do_assunto' };
}
