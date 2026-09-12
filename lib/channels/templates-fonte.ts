/**
 * De ONDE a tela busca as definições aprovadas de uma conexão.
 *
 * ─── Por que isto não é um `if` na tela ────────────────────────────────────
 *
 * Há duas rotas: a do canal oficial (`/channels/templates`, que lê o espelho da
 * WABA) e a do canal intermediado (`/channels/partner/templates`, que pergunta
 * ao adapter da conexão). Perguntar "qual delas?" com o nome do provider na mão
 * é o `if (provider === ...)` que o invariante 1 da doutrina proíbe — e que o
 * `lint:channels` reprova.
 *
 * A tela recebe um rótulo NEUTRO e monta a URL com ele. Um canal novo entra
 * aqui, e nenhuma linha muda do lado de lá.
 *
 * ─── Por que não basta juntar as duas listas ───────────────────────────────
 *
 * Porque a definição é aprovada POR CONTA. Oferecer no seletor de uma conversa
 * um modelo que existe só na outra conta produz um envio que a plataforma
 * recusa — e o operador, que escolheu de uma lista que o CRM lhe ofereceu,
 * conclui que o sistema está quebrado. Melhor mostrar menos e certo.
 *
 * ─── A MODALIDADE entrou, e ela é a correção que estava escrita aqui ───────
 *
 * Este arquivo mapeava `stevo → null` com um comentário dizendo, com todas as
 * letras, que a instância OFICIAL daquele provider tem definições aprovadas (a
 * WABA é da Meta) e que escolher pela modalidade "exigiria que este mapa
 * recebesse a sessão, e não o provider — mudança que atravessa todos os
 * chamadores".
 *
 * A mudança aconteceu. O custo de não fazê-la era concreto: numa conversa por
 * canal intermediado oficial fora das 24h, o inbox BARRAVA o texto livre (a
 * janela sabe da modalidade desde a 0206) e não oferecia modelo nenhum — o
 * operador ficava sem caminho, que é exatamente o que `JanelaFechadaAviso`
 * existe para não deixar acontecer.
 */
import type { ChannelMode, ChannelProvider } from "./types";

export type FonteDeTemplates = "oficial" | "parceiro";

/**
 * Qual rota serve as definições de cada canal de modalidade ÚNICA.
 *
 * MAPA EXPLÍCITO, e não derivado de uma capability. A primeira versão usava
 * `canManageTemplates` como discriminante e estava errada: o canal oficial
 * TAMBÉM gerencia definições pela API, então os dois respondiam `true` e todo
 * canal caía na mesma rota. Capability descreve o que o CANAL faz; isto aqui é
 * uma decisão da NOSSA arquitetura de rotas, e as duas não coincidem por sorte.
 *
 * `Record<ChannelProvider, …>` de propósito: um canal novo não compila até
 * alguém decidir de onde vêm as definições dele. Esquecer essa decisão devolve
 * lista vazia em silêncio — que foi exatamente o defeito de origem.
 */
const FONTE: Record<ChannelProvider, FonteDeTemplates | null> = {
  // Manda texto livre a qualquer hora: não há definição a listar, e um seletor
  // ali ofereceria solução para um problema que este canal não tem.
  waha: null,
  meta_cloud: "oficial",
  zernio: "parceiro",
  /**
   * O que responder quando a MODALIDADE não foi gravada.
   *
   * `null`, e é a resposta conservadora: este provider hospeda os dois mundos, e
   * sem saber qual deles é esta conexão, oferecer um seletor faria o número por
   * QR — que não tem definição nenhuma — mostrar uma lista vazia, com o operador
   * concluindo que a sincronização quebrou. Quem sabe é `FONTE_POR_MODO`, logo
   * abaixo; esta linha é o que sobra quando o banco não diz.
   */
  stevo: null,
};

/**
 * A fonte por MODALIDADE, para os providers que hospedam mais de uma.
 *
 * Mesma forma de `CAPACIDADES_POR_MODO` em `capabilities.ts`, e pelo mesmo
 * motivo: só entra aqui quem de fato tem duas caras, e um `Record` completo
 * obrigaria a inventar duas linhas idênticas para os canais de modalidade única.
 */
const FONTE_POR_MODO: Partial<Record<ChannelProvider, Record<ChannelMode, FonteDeTemplates | null>>> = {
  stevo: {
    // Por baixo é a WABA da Meta, mas quem guarda as definições é a conta do
    // intermediário — então a rota é a do seam (`adapter.templates`), e não a
    // do canal oficial direto, que lê `metaSessionForOrg` e devolveria vazio.
    oficial: "parceiro",
    // Número ligado por QR: não há WABA por trás, e portanto não há definição
    // aprovada para listar.
    qr: null,
  },
};

/**
 * `null` quando esta conexão não trabalha com definições aprovadas.
 *
 * `modo` é opcional porque nem todo chamador tem a sessão em mãos — e porque a
 * coluna `provider_mode` é nullable por desenho (a 0206 explica: `null` afirma
 * "este provider tem modalidade única, pergunte a ele").
 */
export function fonteDeTemplates(
  provider: string | null | undefined,
  modo?: string | null,
): FonteDeTemplates | null {
  if (!provider) return null;
  const porModo = FONTE_POR_MODO[provider as ChannelProvider];
  if (porModo && modo) return porModo[modo as ChannelMode] ?? null;
  return FONTE[provider as ChannelProvider] ?? null;
}

/** A rota que serve as definições desta fonte. */
export function rotaDeTemplates(fonte: FonteDeTemplates): string {
  return fonte === "parceiro"
    ? "/api/v1/channels/partner/templates"
    : "/api/v1/channels/templates";
}
