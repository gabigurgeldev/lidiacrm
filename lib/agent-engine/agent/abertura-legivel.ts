/**
 * A abertura do turno lida como uma conversa, e com o relógio na mão.
 *
 * ## Dois defeitos
 *
 * 1. **O agente não sabia que dia era.** Nada no prompt dizia a data nem a
 *    hora. "Posso passar amanhã?" virava uma conta impossível, e "atendemos até
 *    as 18h" não tinha contra o que ser comparado. O modelo chutava a data do
 *    treino dele.
 * 2. **O histórico chegava como um blob JSON.** As últimas mensagens iam dentro
 *    de `JSON.stringify(context)`, misturadas a contato, marcadores e decisão
 *    humana, com `"direction":"inbound"` e horário ISO em UTC. O modelo lia uma
 *    estrutura de dados, não uma conversa, e respondia como quem preenche
 *    formulário.
 *
 * ## O que muda
 *
 * - `blocoDoMomento` dá data, dia da semana e hora no fuso do atendimento.
 * - `renderizarConversa` escreve o histórico como transcrição, da mais antiga
 *   para a mais recente: "Cliente (ter 28/07 14:02): …" / "Nós (…): …".
 *
 * O contato e a última decisão humana continuam em JSON, num bloco próprio: são
 * dados, e o modelo os usa como dados.
 *
 * ## Fuso
 *
 * O do horário de funcionamento do agente quando ele existe; senão o do número
 * (ritmo de envio); senão `America/Sao_Paulo`. Fuso inválido cai no padrão —
 * um `Intl` que lança aqui derrubaria o turno inteiro.
 */

import type { LeadContextMessage } from '../edge/crm/get-lead-context';

export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Devolve o fuso se o `Intl` o conhece; senão o padrão. Nunca lança. */
export function fusoUtilizavel(fuso: string | null | undefined): string {
  if (typeof fuso !== 'string' || fuso.trim() === '') return FUSO_PADRAO;
  try {
    // Só valida o fuso — o idioma não importa aqui.
    new Intl.DateTimeFormat(undefined, { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

function partes(data: Date, fuso: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(data).map((p) => [p.type, p.value]));
}

/** "## Agora\nterça-feira, 28 de julho de 2026, 15:00 (fuso America/Sao_Paulo)". */
export function blocoDoMomento(agora: Date, fuso: string | null | undefined): string {
  const f = fusoUtilizavel(fuso);
  const p = partes(agora, f);
  return [
    '## Agora',
    `${p.weekday}, ${p.day} de ${p.month} de ${p.year}, ${p.hour}:${p.minute} (fuso ${f}).`,
    'Use esta data e hora para "hoje", "amanhã", prazos e horário de atendimento — não suponha outra.',
  ].join('\n');
}

/** "ter 28/07 14:02" no fuso dado; data inválida vira "?". */
function carimbo(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${(p.weekday ?? '').replace('.', '')} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * O histórico como transcrição. `mostrarMidia` = o turno pode usar o caminho da
 * mídia (sem projeção); com projeção, o caminho não entra no prompt.
 */
export function renderizarConversa(
  mensagens: ReadonlyArray<LeadContextMessage> | undefined,
  opts: { fuso?: string | null; mostrarMidia: boolean },
): string {
  const lista = Array.isArray(mensagens) ? mensagens : [];
  if (lista.length === 0) return '(nenhuma mensagem ainda)';
  const fuso = fusoUtilizavel(opts.fuso);
  return lista
    .map((m) => {
      // "Nós", não "Você": a mensagem que saiu pode ter sido de uma pessoa da
      // equipe, e atribuí-la ao agente o faria defender o que não disse.
      const quem = m.direction === 'inbound' ? 'Cliente' : 'Nós';
      const corpo = (m.body ?? '').trim() === '' ? '(sem texto)' : m.body;
      const midia =
        opts.mostrarMidia && typeof m.media_storage_path === 'string' && m.media_storage_path !== ''
          ? ` [mídia: ${m.media_storage_path}]`
          : '';
      return `${quem} (${carimbo(m.sent_at, fuso)}): ${corpo}${midia}`;
    })
    .join('\n');
}
