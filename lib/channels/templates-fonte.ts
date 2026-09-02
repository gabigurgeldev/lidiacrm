/**
 * De ONDE a tela busca as definições aprovadas de uma conversa.
 *
 * ─── Por que isto não é um `if` na tela ────────────────────────────────────
 *
 * Há duas rotas: a do canal oficial (`/channels/templates`, que resolve a
 * conexão pela sessão da Meta) e a do canal intermediado
 * (`/channels/partner/templates`, que resolve pela conexão de parceiro).
 * Perguntar "qual delas?" com o nome do provider na mão é o `if (provider ===
 * ...)` que o invariante 1 da doutrina proíbe — e que o `lint:channels` reprova.
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
 */
import type { ChannelProvider } from "./types";

export type FonteDeTemplates = "oficial" | "parceiro";

/**
 * Qual rota serve as definições de cada canal.
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
  // `null` — e esta é uma decisão, não um esquecimento.
  //
  // A instância OFICIAL deste intermediário tem, sim, definições aprovadas (a
  // WABA é da Meta), e elas vivem na API oficial dele. Mas a fonte é escolhida
  // aqui pelo PROVIDER, e este provider hospeda as duas modalidades: apontar
  // para uma rota de templates faria o número ligado por QR — que não tem
  // definição nenhuma — oferecer um seletor vazio, e o operador concluir que a
  // sincronização quebrou.
  //
  // Escolher pela MODALIDADE exigiria que este mapa recebesse a sessão, e não o
  // provider — mudança que atravessa todos os chamadores. Enquanto ela não
  // acontece, `null` é a resposta honesta: a tela não oferece definições que não
  // pode garantir, e o envio livre (que é o caminho comum aqui) segue intacto.
  stevo: null,
};

/** `null` quando este canal não trabalha com definições aprovadas. */
export function fonteDeTemplates(provider: string | null | undefined): FonteDeTemplates | null {
  if (!provider) return null;
  return FONTE[provider as ChannelProvider] ?? null;
}

/** A rota que serve as definições desta fonte. */
export function rotaDeTemplates(fonte: FonteDeTemplates): string {
  return fonte === "parceiro"
    ? "/api/v1/channels/partner/templates"
    : "/api/v1/channels/templates";
}
