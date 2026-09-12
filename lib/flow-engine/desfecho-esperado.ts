/**
 * "NÃO ERA PARA ESTE FLUXO" NÃO É ERRO — e tratar os dois igual custa os dois.
 *
 * ─── O que a tela mostrava ──────────────────────────────────────────────────
 *
 * Um fluxo que começa por PALAVRA é armado por toda mensagem que chega: o
 * matcher não sabe ler a config do bloco, então ele cria a execução e o bloco
 * decide. Quando a palavra não está na mensagem, o bloco devolve `dead` — e
 * `dead` é a mesma coluna de "o grafo está corrompido" e "não há conexão de
 * WhatsApp".
 *
 * Consequência, medida com o dono do produto olhando: cada "oi" que chega vira
 * uma linha VERMELHA dizendo "Parou com erro", com um slug
 * (`mensagem_sem_a_palavra`) que não diz o que foi comparado — e mais um aviso
 * na Central dizendo "Automação parou". Numa instalação que recebe cem
 * mensagens por dia e tem um fluxo por palavra, são cem alarmes falsos por dia.
 *
 * Os dois efeitos são piores que o barulho:
 *
 *   1. **O vermelho perde o sentido.** Quem vê cem alarmes falsos para de olhar,
 *      e a falha de verdade — a que devia acordar alguém — chega no meio deles.
 *   2. **O diagnóstico some.** Este mesmo arquivo já pagou um defeito em que o
 *      texto da mensagem NÃO chegava ao bloco: toda execução morria com este
 *      mesmo slug, 100% das vezes, e a tela ficava idêntica ao caso normal.
 *      Não havia como distinguir "a mensagem não era para este fluxo" de "o
 *      texto nunca chegou" — e foi assim que aquilo durou.
 *
 * ─── Por que um MÓDULO, e não um `if` de cada lado ──────────────────────────
 *
 * Porque há dois consumidores e eles têm de concordar: o motor (que decide se
 * abre aviso na Central) e a tela (que decide a cor e a frase). Duas listas
 * divergiriam no primeiro motivo novo, e o sintoma seria o pior possível — a
 * tela chamando de normal o que o motor tratou como falha, ou o contrário.
 *
 * ─── Por que não virou um `status` novo no banco ────────────────────────────
 *
 * `flow_executions.status` tem CHECK, e um valor novo é migration + baseline +
 * MANIFEST, com clone antigo recusando a linha até atualizar. O que se ganharia
 * é uma coluna mais bonita; o que se perde é a correção não chegar hoje em quem
 * já tem o problema. A informação já está em `last_error`, e ela basta.
 */

/**
 * Os motivos que significam "esta execução não tinha o que fazer", e não
 * "alguma coisa quebrou".
 *
 * LISTA CURTA DE PROPÓSITO. `sem_lead_para_atribuir`, `marcador_vazio`,
 * `fila_sem_ninguem_na_ordem` e afins NÃO entram: eles são configuração faltando
 * ou dado ausente, e o operador precisa mesmo ser acordado. Entra aqui só o que
 * é consequência normal de o gatilho ser avaliado por mensagem.
 */
export const MOTIVOS_ESPERADOS = ["mensagem_sem_a_palavra"] as const;

/**
 * O motivo casa por PREFIXO, porque ele carrega diagnóstico depois dos dois
 * pontos (`mensagem_sem_a_palavra: recebi "oi" e esperava …`). Comparar por
 * igualdade voltaria a pintar de vermelho no dia em que o diagnóstico entrasse
 * — que é exatamente o commit que trouxe este arquivo.
 */
export function ehDesfechoEsperado(motivo: string | null | undefined): boolean {
  if (!motivo) return false;
  return MOTIVOS_ESPERADOS.some((m) => motivo === m || motivo.startsWith(`${m}:`));
}

/** O `motivo` sem o prefixo técnico — o que sobra é a frase de diagnóstico. */
export function diagnosticoDoMotivo(motivo: string): string {
  const i = motivo.indexOf(":");
  return i === -1 ? "" : motivo.slice(i + 1).trim();
}
