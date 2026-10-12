/**
 * Quem decide se a entrevista acabou é o SERVIDOR, não o modelo.
 *
 * Até 2026-10-12 o modelo escolhia `kind` livremente, e três coisas faziam a
 * entrevista sumir: (1) o prompt mandava encerrar quando "o essencial" estava
 * coberto, e com um texto colado rico o modelo dizia `pronto` na rodada 1 —
 * zero pergunta; (2) resposta sem pergunta válida virava `pronto` em silêncio;
 * (3) a rodada 3 já nascia obrigada a encerrar, então só cabiam duas. Quem
 * testou viu exatamente isso: "as perguntas estão sendo puladas".
 *
 * Agora o modelo devolve, junto com as perguntas, a COBERTURA de cada assunto
 * do checklist com a evidência. O servidor aceita `pronto` só quando os
 * assuntos essenciais têm evidência — e, na primeira rodada, só quando TODOS os
 * assuntos têm. Se o modelo encerrar cedo ou mandar rodada sem pergunta, a
 * rota pede de novo uma vez; se ainda assim não vier pergunta, monta perguntas
 * de reserva do próprio checklist. Pergunta nunca mais some em silêncio.
 *
 * Puro de propósito: é a regra inteira, e o teste a exercita sem modelo.
 */
import {
  ASSUNTOS,
  ASSUNTOS_ESSENCIAIS,
  BANCO_DE_PERGUNTAS,
  MAX_PERGUNTAS_POR_RODADA,
  MAX_RODADAS,
  type Assunto,
  type PerguntaDeReserva,
} from "./entrevista";
import { RESUMO_PADRAO, type EntrevistaNormalizada, type PerguntaDaEntrevista } from "./esquemas";

export type EstadoDoAssunto = "coberto" | "parcial" | "faltando";

export interface CoberturaDoAssunto {
  assunto: Assunto;
  estado: EstadoDoAssunto;
}

export type DecisaoDaRodada =
  | { kind: "aceitar"; saida: EntrevistaNormalizada }
  /** O modelo encerrou cedo ou não mandou pergunta: vale pedir de novo, focado nestes assuntos. */
  | { kind: "refazer"; faltando: Assunto[]; motivo: "pronto_cedo" | "sem_pergunta" };

/**
 * O que ainda falta, na ordem em que vale perguntar: essenciais primeiro,
 * depois o resto do checklist. Assunto que o modelo não citou conta como
 * faltando — silêncio não é evidência.
 */
export function assuntosEmAberto(cobertura: readonly CoberturaDoAssunto[]): Assunto[] {
  const estado = new Map<Assunto, EstadoDoAssunto>();
  for (const c of cobertura) estado.set(c.assunto, c.estado);
  const aberto = (a: Assunto) => (estado.get(a) ?? "faltando") !== "coberto";
  const essenciais = ASSUNTOS_ESSENCIAIS.filter(aberto);
  const demais = ASSUNTOS.filter((a) => !ASSUNTOS_ESSENCIAIS.includes(a) && aberto(a));
  return [...essenciais, ...demais];
}

/**
 * A regra. `rodada` é a rodada PEDIDA (a primeira chamada é 1); depois da
 * última rodada de perguntas (`rodada > MAX_RODADAS`) a entrevista encerra de
 * qualquer jeito — o que faltou vira lacuna, e o agente passa o assunto para
 * uma pessoa.
 */
export function decidirRodada(
  saida: EntrevistaNormalizada,
  cobertura: readonly CoberturaDoAssunto[],
  rodada: number,
): DecisaoDaRodada {
  if (rodada > MAX_RODADAS) {
    return {
      kind: "aceitar",
      saida: saida.kind === "pronto" ? saida : { kind: "pronto", resumo: RESUMO_PADRAO, nicho: saida.nicho },
    };
  }

  const emAberto = assuntosEmAberto(cobertura);

  if (saida.kind === "perguntar") {
    return saida.perguntas.length > 0
      ? { kind: "aceitar", saida }
      : { kind: "refazer", faltando: emAberto, motivo: "sem_pergunta" };
  }

  const essenciaisEmAberto = emAberto.filter((a) => ASSUNTOS_ESSENCIAIS.includes(a));
  // Primeira rodada: encerrar sem perguntar nada só quando o texto cobre o
  // checklist inteiro. A partir da segunda, basta o essencial.
  const podeEncerrar = rodada === 1 ? emAberto.length === 0 : essenciaisEmAberto.length === 0;
  return podeEncerrar ? { kind: "aceitar", saida } : { kind: "refazer", faltando: emAberto, motivo: "pronto_cedo" };
}

/**
 * Perguntas de reserva: quando o modelo, mesmo pedido de novo, não devolve
 * pergunta, a rodada sai do checklist. Uma por assunto em aberto, na ordem de
 * `assuntosEmAberto`. Sem nada em aberto, devolve vazio (e a rota encerra).
 */
export function perguntasDeReserva(faltando: readonly Assunto[]): PerguntaDaEntrevista[] {
  const saida: PerguntaDaEntrevista[] = [];
  for (const assunto of faltando) {
    const bloco = BANCO_DE_PERGUNTAS.find((b) => b.assunto === assunto);
    if (!bloco) continue;
    const r: PerguntaDeReserva = bloco.reserva;
    saida.push({
      pergunta: r.pergunta,
      opcoes: r.opcoes ? [...r.opcoes] : [],
      resposta_livre: !r.opcoes,
      sugestao: r.sugestao ?? null,
    });
    if (saida.length === MAX_PERGUNTAS_POR_RODADA) break;
  }
  return saida;
}

/** O que se diz ao modelo na segunda tentativa: o que ele errou e sobre o que perguntar. */
export function correcaoDaRodada(decisao: Extract<DecisaoDaRodada, { kind: "refazer" }>): string {
  const assuntos = decisao.faltando.join(", ");
  return decisao.motivo === "pronto_cedo"
    ? `CORREÇÃO: você respondeu kind='pronto', mas estes assuntos ainda não têm evidência escrita: ${assuntos}. Responda kind='perguntar' com perguntas sobre eles, começando pelos primeiros.`
    : `CORREÇÃO: você respondeu kind='perguntar' sem nenhuma pergunta válida. Escreva de 1 a 4 perguntas sobre: ${assuntos}.`;
}
