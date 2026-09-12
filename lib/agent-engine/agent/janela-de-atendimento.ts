/**
 * Horário de funcionamento do agente — a regra que a tela oferecia e ninguém lia.
 *
 * ## O defeito que este arquivo existe para consertar
 *
 * `TriggerEditor.tsx` mostra "Só atender em horário de funcionamento" com fuso,
 * início, fim e dias da semana, e grava tudo em
 * `ai_agent_versions.trigger_config.filters.business_hours`. O ÚNICO leitor
 * desse campo era `lib/ai/dispatcher/triggers.ts` — o dispatcher legado, que
 * hoje é NO-OP permanente (`app/api/v1/cron/agent-dispatcher/route.ts`). O
 * runtime vivo (`lib/agent-engine`) nunca soube que o campo existia.
 *
 * Resultado medido numa instalação real (2026-08-18): a versão publicada dizia
 * 08:00–18:00, seg–sex, e o agente respondia 21:55 de uma terça — porque nada
 * consultava a janela. Um controle que a tela oferece e o código ignora mente
 * para quem configurou; é o mesmo defeito que o `HANDOFF-followup-vivo.md`
 * cataloga como "o tempo adaptativo é decorativo".
 *
 * ## Por que ADIAR, e não descartar
 *
 * O dispatcher morto tratava "fora da janela" como `no_match`: a mensagem
 * simplesmente não era respondida, nunca. Aqui o turno é REAGENDADO para a
 * abertura da janela — quem escreveu às 22h é atendido às 8h, e não no
 * esquecimento. Silêncio permanente é o modo de falha que este repo já pagou
 * caro; a janela pode atrasar a resposta, não pode sumir com ela.
 *
 * ## O RELÓGIO mudou de casa; a LEITURA ficou
 *
 * A conta de "está aberta?" e "quanto falta para abrir?" vive em
 * `lib/horario/janela-semanal.ts` desde que o motor de fluxos ganhou o bloco
 * "Horário de funcionamento" — um nó de fluxo não pode importar
 * `lib/agent-engine` (o registry do motor é mantido puro por
 * `lib/flow-engine/registry.test.ts`), e uma segunda cópia da conta divergiria
 * na primeira correção, com o agente respondendo numa hora e o fluxo em outra.
 *
 * O que continua aqui é a única parte que é DO AGENTE: saber que a janela mora
 * em `trigger_config.filters.business_hours`. O jsonb é vocabulário desta
 * feature, não do horário.
 *
 * ## Falha ABERTA, sempre
 *
 * `trigger_config` é jsonb livre: fuso inválido, horário torto, dias vazios,
 * shape estranho — tudo devolve `null` (sem janela), e sem janela o agente
 * responde. A direção segura aqui é o contrário da doutrina de tools: uma
 * config quebrada não pode virar mordaça.
 */

import { lerJanelaSemanal, type JanelaSemanal } from '@/lib/horario/janela-semanal';

export { msAteAJanelaAbrir } from '@/lib/horario/janela-semanal';

/** Mesmo formato de `JanelaSemanal` — o nome antigo segue valendo para o agente. */
export type JanelaDeAtendimento = JanelaSemanal;

/**
 * Extrai a janela de `trigger_config` (jsonb livre da versão publicada).
 * `null` = sem janela declarada OU declarada de forma que não dá para obedecer.
 */
export function lerJanelaDeAtendimento(triggerConfig: unknown): JanelaDeAtendimento | null {
  if (typeof triggerConfig !== 'object' || triggerConfig === null) return null;
  const filters = (triggerConfig as { filters?: unknown }).filters;
  if (typeof filters !== 'object' || filters === null) return null;
  const bh = (filters as { business_hours?: unknown }).business_hours;
  if (typeof bh !== 'object' || bh === null) return null;

  return lerJanelaSemanal(bh as Record<string, unknown>);
}
