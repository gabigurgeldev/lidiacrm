/**
 * O TEXTO DO LEMBRETE — o que a cliente lê antes do horário marcado.
 *
 * ─── Data ABSOLUTA, sempre ───────────────────────────────────────────────────
 *
 * "Amanhã às 14h" é a frase natural e é a errada: o texto é escrito agora e
 * LIDO depois. A mensagem vai para a fila (`conversation_scheduled_messages`),
 * e a fila respeita a janela de envio do número — um lembrete escrito às 23h
 * sai às 7h do dia seguinte, quando "amanhã" já virou "hoje". Dia da semana +
 * dia + mês não envelhecem.
 *
 * ─── No fuso DO AGENDAMENTO ──────────────────────────────────────────────────
 *
 * `calendar_appointments.time_zone` é o fuso em que o horário foi combinado. O
 * servidor roda em UTC; formatar no fuso dele diria 17:00 para uma consulta
 * das 14:00 em São Paulo.
 *
 * Só pt-BR por enquanto (limite documentado no plano da 0245).
 */

import { tagDeIdioma } from "@/lib/i18n/datas";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";

/** O que o texto precisa saber — nada de banco aqui. */
export interface DadosDoLembrete {
  /** Nome do contato; `null` vira um "Olá!" sem nome. */
  nomeDoCliente: string | null;
  /** O nome do tipo de atendimento ("Limpeza de pele"). */
  servico: string;
  iniciaEm: Date;
  /** IANA. Inválido cai no padrão do produto, nunca lança. */
  fuso: string;
  /** Principal primeiro. Vazio = a frase sai sem "com ...". */
  profissionais: string[];
  /** Para decidir se o ano precisa aparecer. */
  agora: Date;
}

const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * O idioma da DATA acompanha o do TEXTO, que é português (o lembrete ainda não
 * é traduzido). Vem da camada de i18n, não de um literal — quem traduzir o
 * lembrete troca o idioma aqui e a data vai junto.
 */
const TAG = tagDeIdioma(IDIOMA_PADRAO);

function fusoValido(fuso: string): string {
  try {
    new Intl.DateTimeFormat(TAG, { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/** Primeiro nome, limpo — "MARIA  da silva" vira "Maria". */
function primeiroNome(nome: string | null): string | null {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (primeiro === "" || /\d/.test(primeiro)) return null;
  return primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR");
}

function juntar(nomes: string[]): string {
  const limpos = nomes.map((n) => n.trim()).filter((n) => n !== "");
  if (limpos.length <= 1) return limpos.join("");
  return `${limpos.slice(0, -1).join(", ")} e ${limpos[limpos.length - 1]}`;
}

/** "quinta-feira, 23 de outubro" (com o ano só quando não é o ano corrente). */
export function dataPorExtenso(instante: Date, fuso: string, agora: Date): string {
  const tz = fusoValido(fuso);
  const ano = (d: Date) => new Intl.DateTimeFormat(TAG, { timeZone: tz, year: "numeric" }).format(d);
  const comAno = ano(instante) !== ano(agora);
  return new Intl.DateTimeFormat(TAG, {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(comAno ? { year: "numeric" as const } : {}),
  }).format(instante);
}

/** "14:30", 24 horas. */
export function horaNoFuso(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat(TAG, {
    timeZone: fusoValido(fuso),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instante);
}

export function textoDoLembrete(d: DadosDoLembrete): string {
  const nome = primeiroNome(d.nomeDoCliente);
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const data = dataPorExtenso(d.iniciaEm, d.fuso, d.agora);
  // "no sábado", "no domingo", "na quinta-feira" — o gênero é do dia.
  const preposicao = /^(sábado|domingo)/.test(data) ? "no" : "na";
  const quando = `${preposicao} ${data}, às ${horaNoFuso(d.iniciaEm, d.fuso)}`;
  const com = d.profissionais.length > 0 ? `, com ${juntar(d.profissionais)}` : "";
  const servico = d.servico.trim() || "atendimento";
  return (
    `${saudacao} Passando para lembrar do seu horário: ${servico} ${quando}${com}. ` +
    "Se precisar remarcar, é só responder esta mensagem."
  );
}
