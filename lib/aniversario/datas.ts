/**
 * As contas de calendário da mensagem de aniversário — puras, testáveis.
 *
 * O "hoje" é o da EMPRESA (`organizations.timezone`), nunca o do servidor: o
 * scheduler roda em UTC, e às 22h de Brasília já é o dia seguinte em UTC — quem
 * faz aniversário amanhã receberia os parabéns hoje à noite.
 */

export type DiaLocal = {
  /** `YYYY-MM-DD` no fuso da empresa. */
  data: string;
  ano: number;
  mes: number;
  dia: number;
  /** 0–23 no fuso da empresa. */
  hora: number;
};

const FUSO_PADRAO = "America/Sao_Paulo";

export function diaLocal(agora: Date, fuso: string | null | undefined): DiaLocal {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso || FUSO_PADRAO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(agora);
  } catch {
    // Fuso inválido gravado no banco não pode derrubar a rodada de todas as
    // outras empresas: vale o padrão do produto.
    return diaLocal(agora, FUSO_PADRAO);
  }
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? "0");
  const ano = v("year");
  const mes = v("month");
  const dia = v("day");
  return {
    data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
    ano,
    mes,
    dia,
    hora: v("hour") % 24,
  };
}

export function anoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/**
 * Os `MM-DD` de nascimento que fazem aniversário neste dia. Em ano NÃO
 * bissexto, quem nasceu em 29/02 comemora no 28/02 — sem isto, essa pessoa só
 * receberia os parabéns de quatro em quatro anos.
 */
export function mmddDoDia(ano: number, mes: number, dia: number): string[] {
  const mmdd = `${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return mes === 2 && dia === 28 && !anoBissexto(ano) ? [mmdd, "02-29"] : [mmdd];
}

/** `DD/MM` para o nome do disparo ("Aniversariantes de 29/09"). */
export function ddmm(dia: DiaLocal): string {
  return `${String(dia.dia).padStart(2, "0")}/${String(dia.mes).padStart(2, "0")}`;
}

/** Os próximos `n` dias a partir de `inicio` (inclusive), como `MM-DD` + data. */
export function proximosDias(inicio: DiaLocal, n: number): { data: string; mmdd: string[] }[] {
  const base = Date.UTC(inicio.ano, inicio.mes - 1, inicio.dia);
  const saida: { data: string; mmdd: string[] }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86_400_000);
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    const dia = d.getUTCDate();
    saida.push({
      data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      mmdd: mmddDoDia(ano, mes, dia),
    });
  }
  return saida;
}
