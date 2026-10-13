/**
 * Payloads de enquete e lista do transporte por QR.
 *
 * Mora aqui porque nomeia o provider — `lib/waha/` é allowlist do
 * `lint:channels`. A decisão de QUAL formato sai é de
 * `lib/channels/opcoes-interativas.ts`; isto só traduz.
 *
 * Limites: os da plataforma do WhatsApp, que o transporte repassa sem validar —
 * passar deles vira 400 ou, pior, mensagem entregue e não desenhada. Pergunta da
 * enquete até 255 caracteres; título de linha da lista até 24 e descrição até
 * 72; botão até 20.
 */
import {
  BOTAO_PADRAO_DA_LISTA,
  cortar,
  linhaDeLista,
} from "@/lib/channels/opcoes-interativas";
import type { OpcoesInterativas } from "@/lib/schemas";

const LIMITE_PERGUNTA_ENQUETE = 255;
const LIMITE_OPCAO_ENQUETE = 100;
const LIMITE_TITULO_LINHA = 24;
const LIMITE_DESCRICAO_LINHA = 72;
const LIMITE_BOTAO = 20;
const LIMITE_DESCRICAO_LISTA = 1024;

/** Corpo de POST /api/sendPoll, sem `session`/`chatId` (o client põe). */
export function wahaPollPayload(o: OpcoesInterativas) {
  return {
    poll: {
      name: cortar(o.pergunta, LIMITE_PERGUNTA_ENQUETE),
      // O voto volta com o TEXTO da opção (`selectedOptions`) — por isso o
      // rótulo vai inteiro sempre que cabe, e `opcaoEscolhida` casa pelo começo
      // quando não coube.
      options: o.opcoes.map((x) => cortar(x.label, LIMITE_OPCAO_ENQUETE)),
      // Uma escolha só: o menu do fluxo segue UM caminho, e o agente lê UMA
      // resposta. Múltipla escolha mandaria votos cumulativos sem ramo para eles.
      multipleAnswers: false,
    },
  };
}

/**
 * Título da lista. OBRIGATÓRIO no transporte: sem ele o envio volta
 * `400 message.title should not be empty`, e a lista do agente NUNCA saiu
 * (medido em produção, 2026-10-13). Pergunta curta vira o próprio título;
 * pergunta longa fica na descrição, com um título neutro em cima.
 */
const LIMITE_TITULO_LISTA = 60;
export const TITULO_PADRAO_DA_LISTA = "Escolha uma opção";

/** Corpo de POST /api/sendList, sem `session`/`chatId`. */
export function wahaListPayload(o: OpcoesInterativas) {
  const pergunta = o.pergunta.trim();
  const cabeNoTitulo = pergunta.length > 0 && pergunta.length <= LIMITE_TITULO_LISTA;
  return {
    message: {
      title: cabeNoTitulo ? pergunta : TITULO_PADRAO_DA_LISTA,
      ...(cabeNoTitulo ? {} : { description: cortar(pergunta, LIMITE_DESCRICAO_LISTA) }),
      button: cortar(o.botao ?? BOTAO_PADRAO_DA_LISTA, LIMITE_BOTAO),
      sections: [
        {
          title: "Opções",
          rows: o.opcoes.map((x) => {
            const linha = linhaDeLista(x, {
              titulo: LIMITE_TITULO_LINHA,
              descricao: LIMITE_DESCRICAO_LINHA,
            });
            // `rowId` é o NOSSO id da opção: é ele que volta na seleção, imune
            // ao corte do título.
            return {
              title: linha.titulo,
              rowId: linha.id,
              ...(linha.descricao ? { description: linha.descricao } : {}),
            };
          }),
        },
      ],
    },
  };
}
