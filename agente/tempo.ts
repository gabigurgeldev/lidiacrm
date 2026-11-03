/**
 * "Hoje" no fuso de quem pergunta — para o limite diário e para a agenda.
 *
 * O servidor roda em UTC. Sem isto, o "dia" do limite de mensagens viraria às
 * 21h de Brasília, e "minha agenda de hoje" depois das 21h mostraria amanhã.
 */
export const FUSO_PADRAO = "America/Sao_Paulo";

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesNoFuso(fuso: string, instante: Date): Partes {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const mapa: Record<string, number> = {};
  for (const p of fmt.formatToParts(instante)) {
    if (p.type !== "literal") mapa[p.type] = Number(p.value);
  }
  return {
    ano: mapa.year ?? 1970,
    mes: mapa.month ?? 1,
    dia: mapa.day ?? 1,
    hora: mapa.hour ?? 0,
    minuto: mapa.minute ?? 0,
    segundo: mapa.second ?? 0,
  };
}

/** Diferença, em ms, entre o relógio do fuso e o UTC naquele instante. */
function deslocamentoMs(fuso: string, instante: Date): number {
  const p = partesNoFuso(fuso, instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Fuso inválido vira o padrão: um fuso cadastrado errado não pode derrubar a assistente. */
export function fusoOuPadrao(fuso: string | null | undefined): string {
  if (!fuso) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/** Meia-noite do dia de `instante` no fuso, deslocada `dias` dias. */
export function inicioDoDia(fuso: string, instante: Date, dias = 0): Date {
  const p = partesNoFuso(fuso, instante);
  const palpite = Date.UTC(p.ano, p.mes - 1, p.dia + dias, 0, 0, 0);
  return new Date(palpite - deslocamentoMs(fuso, new Date(palpite)));
}

/** Dia 1 do mês de `instante`, meia-noite no fuso. */
export function inicioDoMes(fuso: string, instante: Date): Date {
  const p = partesNoFuso(fuso, instante);
  const palpite = Date.UTC(p.ano, p.mes - 1, 1, 0, 0, 0);
  return new Date(palpite - deslocamentoMs(fuso, new Date(palpite)));
}

/** "03/11 14:30" no fuso — o formato que a assistente repete ao usuário. */
export function dataHoraCurta(fuso: string, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "03/11/2026" no fuso. */
export function dataCurta(fuso: string, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
