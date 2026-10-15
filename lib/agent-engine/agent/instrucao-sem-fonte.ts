/**
 * O que o MODELO lê quando o material da empresa não sustenta a resposta.
 *
 * Um lugar só para as frases, porque são três caminhos que precisam dizer a
 * mesma coisa: a busca que voltou vazia, a busca que falhou e o veto do gate de
 * fundamentação. Enquanto cada um tinha a sua, um dizia "responda com o que você
 * já sabe" (convite a inventar), outro "diga que vai confirmar" (promessa que
 * nada cumpre) e outro "siga sem ele".
 *
 * ⚠️ Estas frases viajam na chave `instrucao` do retorno, NUNCA em `message`/
 * `error`: a projeção (`projecao.ts`) traduz texto sob chave de erro que cite
 * nome de ferramenta, e a instrução precisa citar `request_human_handoff` — sob
 * `message` ela viraria "não consegui concluir essa verificação".
 */
import type { ModoSemFonte } from '@/lib/schemas/settings';

const NAO_AFIRME =
  'NADA no material da empresa responde a isso. Não afirme nada sobre o assunto — nem produto, ' +
  'característica, estoque, preço, prazo, política, horário ou endereço — e não diga que vai confirmar depois.';

export function instrucaoSemFonte(modo: ModoSemFonte): string {
  return modo === 'equipe'
    ? `${NAO_AFIRME} Diga ao cliente, em uma frase, que vai chamar alguém da equipe para ajudar com isso ` +
        'e chame request_human_handoff AGORA, explicando no motivo o que ele perguntou.'
    : `${NAO_AFIRME} Diga com clareza que você não tem essa informação, sem prometer retorno, fila ou ` +
        'que alguém vai responder. Ofereça ajuda com o que você consegue fazer e siga a conversa.';
}

/** Busca que FALHOU (sem material, sem chave, base fora do ar): mesma saída, motivo diferente. */
export function instrucaoBuscaIndisponivel(modo: ModoSemFonte): string {
  return (
    'Não foi possível consultar o material da empresa agora. Só afirme o que estiver nas suas ' +
    `instruções ou no resultado de outra ferramenta. Para o resto: ${instrucaoSemFonte(modo)}`
  );
}

/** Trechos na faixa cinza: parecidos com a pergunta, não necessariamente a resposta. */
export const INSTRUCAO_FAIXA_CINZA =
  'Os trechos marcados com relevancia "baixa" são só PARECIDOS com a pergunta. Use um deles apenas se ' +
  'responder EXATAMENTE ao que o cliente perguntou — produto, serviço ou modelo parecido não serve. ' +
  'Se nenhum responder, trate como se a busca não tivesse achado nada.';

/** Afirmação sem fonte e sem busca no turno — o caso dominante medido em produção. */
export const INSTRUCAO_BUSQUE_ANTES =
  'Antes de afirmar isso ao cliente, procure no material da empresa (search_knowledge). ' +
  'Só afirme o que os trechos retornados sustentarem.';
