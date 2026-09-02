import type { ChannelProvider } from "./types";

/**
 * COMO O NÚMERO FOI LIGADO — a pergunta que o operador faz, não a que o código faz.
 *
 * ═══ Por que isto mora em `lib/channels/` ═══
 *
 * Porque traduzir o nome de um provider em "QR code" é NOMEÁ-LO, e a doutrina
 * `restricao-de-canal` reserva isso a esta pasta — `pnpm lint:channels` reprova
 * arquivo novo fora dela que cite o nome. O componente que desenha o selo
 * (`components/channels/TipoDeCanal.tsx`) chama esta função e nunca vê a string.
 *
 * ═══ Por que a tela precisa disso ═══
 *
 * Os tipos parecem o mesmo número na tela e têm regras de envio OPOSTAS: no canal
 * oficial existe a janela de 24h (fora dela só sai modelo aprovado, o resto a Meta
 * recusa) e no número por QR não existe janela nenhuma. O produto já ensina isso
 * na conversa (`JanelaSelo`), mas o seletor de números mostrava rótulos
 * indistinguíveis — a pessoa escolhia o número sem saber por qual regra ia
 * responder.
 *
 * ═══ Por que DUAS dimensões, e não uma ═══
 *
 * A primeira versão devolvia um eixo só (`"qr" | "oficial" | "desconhecido"`), e
 * por isso o canal intermediado não tinha selo nenhum: ele é oficial POR BAIXO
 * (WABA da Meta, template aprovado pela Meta, janela de 24h da Meta) mas não é
 * ligado direto por nós. Espremer isso em "oficial" apagaria de quem o operador
 * depende quando o envio para; espremer em "desconhecido" — o que se fazia —
 * escondia a janela de 24h, que é a regra que mais dói não conhecer.
 *
 * São perguntas independentes, e a tela responde as duas:
 *
 *   transporte   → qual REGRA de envio vale (janela de 24h ou risco de banimento)
 *   viaParceiro  → a QUEM recorrer quando o número cair
 *
 * E há provider em que o transporte não sai da identidade dele: o intermediado
 * pode hospedar tanto instância oficial quanto número ligado por QR na MESMA
 * conta. Para esses, quem decide é o modo gravado na linha — por isso o segundo
 * parâmetro.
 *
 * ═══ `desconhecido` é um estado de verdade, e não um erro ═══
 *
 * Duas causas legítimas: um clone antigo cujo banco ainda não tem a coluna
 * `provider` (a rota devolve a lista sem ela, de propósito — ver
 * `consultaTolerante`), e um provider que esta versão do código não conhece.
 * Nos dois casos a resposta certa é NÃO AFIRMAR NADA: um selo errado sobre a
 * regra de envio é pior que selo nenhum.
 */
export type TransporteDaConexao = "qr" | "oficial" | "desconhecido";

/**
 * O vocabulário da coluna `channel_sessions.provider_mode`.
 *
 * Existe só para os providers que hospedam as DUAS modalidades. Para os demais a
 * coluna é `null` e o transporte sai da identidade do provider — é por isso que
 * ela é anulável no schema em vez de ter default.
 */
export const MODO_OFICIAL = "oficial";
export const MODO_QR = "qr";

export interface ConexaoNaTela {
  /** Qual regra de envio vale para este número. */
  transporte: TransporteDaConexao;
  /** Há um intermediário entre nós e o WhatsApp. */
  viaParceiro: boolean;
  /**
   * Nome comercial do intermediário, quando houver.
   *
   * É DADO, não decisão de quem desenha a tela: quem instala reconhece a marca do
   * serviço que contratou, e "provedor parceiro" obriga a adivinhar. Mora aqui
   * porque é o nome de um provider.
   */
  parceiro: string | null;
}

/**
 * O nome comercial do intermediário que se conecta por credencial de conta.
 *
 * Reexportado por `lib/channels/connect.ts` para que exista UMA fonte: a tela lê
 * daqui pelo resolvedor, a rota lê de lá, e as duas dizem a mesma coisa.
 */
export const ROTULO_PARCEIRO_ZERNIO = "Zernio";

/** O intermediário que se conecta por credencial de CONTA e traz várias instâncias. */
export const ROTULO_PARCEIRO_STEVO = "Stevo";

/**
 * O provider que se conecta por credencial de CONTA.
 *
 * Mora NESTE módulo, e não em `conta-de-instancias.ts`, por uma razão de
 * empacotamento: aquele arquivo fala com o Supabase e com a cifra, então importar
 * dele a partir de um componente `"use client"` arrasta `next/headers` para o
 * bundle do navegador — e o build quebra com "This API is only available in
 * Server Components". Aqui só há constantes e uma função pura.
 *
 * `conta-de-instancias.ts` reexporta como `ACCOUNT_CHANNEL_PROVIDER`, para quem
 * está do lado do servidor continuar lendo o nome que descreve o papel.
 */
export const PROVIDER_DA_CONTA: ChannelProvider = "stevo";

/**
 * `"pelo-modo"` = o provider hospeda as duas modalidades e quem decide é a linha.
 *
 * `Record<ChannelProvider, …>` e não um objeto solto: assim o typecheck cobra uma
 * entrada quando um provider novo entra em `ChannelProvider`. Sem isso, o provider
 * novo cairia no `default` silencioso e nasceria sem selo — que foi exatamente o
 * que aconteceu com o intermediado.
 */
interface DescricaoDoProvider {
  transporte: TransporteDaConexao | "pelo-modo";
  viaParceiro: boolean;
  parceiro: string | null;
}

// Chaves literais e não as constantes nomeadas — as constantes são tipadas como
// `ChannelProvider` (a união inteira), e uma chave computada a partir delas faz o
// TypeScript inferir um índice aberto: a exaustividade que este `Record` existe
// para cobrar iria embora justo aqui. É a mesma escolha de `capabilities.ts`.
const DESCRICAO: Readonly<Record<ChannelProvider, DescricaoDoProvider>> = {
  waha: { transporte: "qr", viaParceiro: false, parceiro: null },
  meta_cloud: { transporte: "oficial", viaParceiro: false, parceiro: null },
  // Intermediado por credencial de conta: é um BSP, então por baixo é a WABA da
  // Meta — a janela de 24h e os templates aprovados valem igual.
  zernio: {
    transporte: "oficial",
    viaParceiro: true,
    parceiro: ROTULO_PARCEIRO_ZERNIO,
  },
  // Intermediário de CONTA: a mesma conta hospeda instância oficial e número
  // ligado por QR, então o transporte não sai da identidade dele — sai do modo
  // gravado na linha (`channel_sessions.provider_mode`, migration 0206).
  stevo: {
    transporte: "pelo-modo",
    viaParceiro: true,
    parceiro: ROTULO_PARCEIRO_STEVO,
  },
};

const DESCONHECIDO: ConexaoNaTela = {
  transporte: "desconhecido",
  viaParceiro: false,
  parceiro: null,
};

export function conexaoNaTela(
  provider: string | null | undefined,
  modo?: string | null,
): ConexaoNaTela {
  if (!provider) return DESCONHECIDO;
  const d = DESCRICAO[provider as ChannelProvider];
  if (!d) return DESCONHECIDO;

  if (d.transporte !== "pelo-modo") {
    return { transporte: d.transporte, viaParceiro: d.viaParceiro, parceiro: d.parceiro };
  }

  // Provider de duas modalidades sem modo gravado: não dá para afirmar a regra de
  // envio, e afirmar a errada é o dano que este módulo existe para evitar. O selo
  // some; o canal continua funcionando.
  const transporte =
    modo === MODO_OFICIAL ? "oficial" : modo === MODO_QR ? "qr" : "desconhecido";
  if (transporte === "desconhecido") return DESCONHECIDO;
  return { transporte, viaParceiro: d.viaParceiro, parceiro: d.parceiro };
}

/**
 * A forma antiga, de um eixo só, mantida para os chamadores que só perguntam a
 * regra de envio. Não some: o eixo do transporte continua sendo a pergunta certa
 * para quem decide se cabe texto livre.
 */
export function tipoDaConexao(
  provider: string | null | undefined,
  modo?: string | null,
): TransporteDaConexao {
  return conexaoNaTela(provider, modo).transporte;
}

/** Compatibilidade de nome com a versão anterior deste módulo. */
export type TipoDeConexao = TransporteDaConexao;

/**
 * O texto do selo. Curto porque ele divide a linha com o nome do número, que é
 * a informação principal — "Conectado por leitura de QR code" empurraria o
 * telefone para fora em qualquer coluna estreita.
 */
export const ROTULO_DO_TIPO: Readonly<
  Record<Exclude<TransporteDaConexao, "desconhecido">, string>
> = {
  qr: "QR code",
  oficial: "Oficial",
};

/** A frase inteira, para o `title`/`aria-label` de quem quiser o contexto. */
export const EXPLICACAO_DO_TIPO: Readonly<
  Record<Exclude<TransporteDaConexao, "desconhecido">, string>
> = {
  qr: "Número conectado lendo o QR code no aparelho.",
  oficial: "Canal oficial da Meta — fora da janela de 24h só sai modelo aprovado.",
};

/**
 * A mesma frase quando há intermediário. Separada em vez de concatenada com um
 * "via X" no fim porque a diferença não é só de quem: quem liga por QR na conta
 * do parceiro não escaneia nada no NOSSO sistema, e mandar essa pessoa procurar
 * o QR aqui é o suporte que ninguém quer dar.
 */
export const EXPLICACAO_VIA_PARCEIRO: Readonly<
  Record<Exclude<TransporteDaConexao, "desconhecido">, string>
> = {
  qr: "Número ligado por QR code dentro do provedor parceiro — quem reconecta é ele, não esta tela.",
  oficial:
    "Canal oficial da Meta pelo provedor parceiro — fora da janela de 24h só sai modelo aprovado.",
};
