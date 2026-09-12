/**
 * A JANELA SEMANAL — "das 08:00 às 18:00, de segunda a sexta, neste fuso".
 *
 * ## Por que este arquivo existe separado
 *
 * A regra nasceu em `lib/agent-engine/agent/janela-de-atendimento.ts`, para o
 * horário de funcionamento do agente de IA, e ficou lá sozinha por meses. Quando
 * o motor de fluxos ganhou o bloco "Horário de funcionamento", a mesma pergunta
 * passou a ter dois donos — e um nó de fluxo **não pode** importar
 * `lib/agent-engine`: `lib/flow-engine/registry.test.ts` mantém todo nó puro
 * (sem Supabase, sem `process.env`), e o runtime do agente arrasta as duas
 * coisas por transitividade.
 *
 * A alternativa era copiar as ~60 linhas. Copiar é o anti-pattern nº 2 da
 * doutrina (duplicação sem fonte declarada), e aqui ele tem um custo concreto:
 * a conta de "quanto falta até abrir" tem um caso de borda por dia da semana e
 * um por meia-noite, e duas cópias divergem na primeira correção — com o agente
 * respondendo numa hora e o fluxo em outra, sem nada na tela dizendo isso.
 *
 * Quem mora aqui é só o RELÓGIO. A leitura de `trigger_config.filters.business_hours`
 * — que é vocabulário do agente, não do horário — fica onde estava.
 *
 * ## Falha ABERTA, sempre
 *
 * Fuso que o ambiente não conhece, horário torto, dias vazios: tudo devolve
 * `null` em `lerJanelaSemanal`, e sem janela quem chama SEGUE. A direção segura
 * aqui é o contrário da doutrina de tools: uma config quebrada não pode virar
 * mordaça — silêncio permanente é o modo de falha que este repo já pagou caro.
 */

export interface JanelaSemanal {
  /** IANA (`America/Sao_Paulo`). Inválido ⇒ a janela inteira é descartada. */
  timezone: string;
  /** `HH:MM` local. */
  start: string;
  /** `HH:MM` local, sempre MAIOR que `start` (ver `lerJanelaSemanal`). */
  end: string;
  /** 0=domingo … 6=sábado, sem repetição, ao menos um. */
  weekdays: number[];
}

const HORA_RX = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** Minutos desde a meia-noite, ou `null` se não for `HH:MM`. */
export function minutosDe(hhmm: string): number | null {
  const m = HORA_RX.exec(hhmm);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** O fuso é conhecido pelo ambiente? `Intl` lança `RangeError` no que não é. */
export function fusoConhecido(timezone: string): boolean {
  try {
    relogioLocal(timezone, new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normaliza os quatro campos crus numa janela obedecível.
 * `null` = não dá para obedecer (e quem chama segue sem restrição).
 */
export function lerJanelaSemanal(bruto: {
  timezone?: unknown;
  start?: unknown;
  end?: unknown;
  weekdays?: unknown;
}): JanelaSemanal | null {
  const { timezone, start, end, weekdays } = bruto;
  if (typeof timezone !== "string" || timezone.trim() === "") return null;
  if (typeof start !== "string" || typeof end !== "string") return null;

  const inicio = minutosDe(start);
  const fim = minutosDe(end);
  if (inicio === null || fim === null) return null;
  // Janela que vira a meia-noite (22:00–02:00) não é suportada, e recusá-la é
  // melhor que interpretá-la ao contrário: `fim <= inicio` viraria "fechado
  // sempre", que é justamente a mordaça que este arquivo não pode criar.
  if (fim <= inicio) return null;

  if (!Array.isArray(weekdays) || weekdays.length === 0) return null;
  const dias = [
    ...new Set(
      weekdays.filter(
        (d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6,
      ),
    ),
  ];
  if (dias.length === 0) return null;

  if (!fusoConhecido(timezone)) return null;

  return { timezone, start, end, weekdays: dias };
}

/** Dia da semana (0–6) e minutos desde a meia-noite NO FUSO da janela. */
function relogioLocal(timezone: string, agora: Date): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(agora);

  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = DIAS[valor("weekday")] ?? 0;
  // 24 é a meia-noite em algumas ICUs com hour12:false — normaliza para 0.
  const hora = Number(valor("hour")) % 24;
  return { dia, minutos: hora * 60 + Number(valor("minute")) };
}

/**
 * `null` = a janela está ABERTA agora. Caso contrário, quantos milissegundos
 * faltam para a próxima abertura — sempre > 0.
 *
 * ponytail: a conta é feita em minutos de relógio de parede, então uma virada de
 * horário de verão dentro do intervalo desloca o alvo em até 1h (quem espera
 * acorda, reavalia e reagenda — a janela nunca é pulada, só reconferida). Brasil
 * não tem DST hoje; se algum fuso de cliente tiver e a hora importar, o upgrade
 * é somar o offset do dia-alvo, não uma biblioteca inteira.
 */
export function msAteAJanelaAbrir(janela: JanelaSemanal, agora: Date): number | null {
  let local: { dia: number; minutos: number };
  try {
    local = relogioLocal(janela.timezone, agora);
  } catch {
    return null; // falha aberta
  }

  const inicio = minutosDe(janela.start);
  const fim = minutosDe(janela.end);
  if (inicio === null || fim === null) return null;

  const aberta =
    janela.weekdays.includes(local.dia) && local.minutos >= inicio && local.minutos < fim;
  if (aberta) return null;

  for (let offset = 0; offset <= 7; offset += 1) {
    const dia = (local.dia + offset) % 7;
    if (!janela.weekdays.includes(dia)) continue;
    if (offset === 0 && local.minutos >= inicio) continue; // hoje a janela já passou
    const minutosAteAbrir = offset * 24 * 60 + inicio - local.minutos;
    if (minutosAteAbrir > 0) return minutosAteAbrir * 60_000;
  }

  return null; // inalcançável com weekdays não-vazio; falha aberta por precaução
}
