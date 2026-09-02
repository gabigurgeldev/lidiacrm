/**
 * O ÚNICO lugar do sistema que pode conhecer a diferença entre os canais.
 *
 * Feature nenhuma pergunta *com quem* falamos — pergunta *o que o canal permite*
 * (invariante 1 de `docs/doctrine/restricao-de-canal.md`). Cada capability abaixo
 * nasce de uma diferença real e medida entre WAHA e Meta Cloud; capability que
 * ninguém consome é código morto, e o teste de matriz reprova.
 */
import type { ChannelCapabilities, ChannelMode, ChannelProvider } from "./types";

export type { ChannelProvider, ChannelCapabilities, ChannelMode };

export const CHANNEL_CAPABILITIES: Record<ChannelProvider, ChannelCapabilities> = {
  // Auto-restrição: falo quando quiser, mas o WhatsApp me bane se eu abusar.
  waha: {
    freeformOutsideWindow: true,
    requiresTemplates: false,
    // Não há WABA por trás: não existe definição aprovada para gerir.
    canManageTemplates: false,
    banRisk: true,
    minIntervalMs: null,
    voiceNote: "server-convert",
    groups: "full",
    costPerMessage: false,
  },
  // Hetero-restrição: não me banem, mas a Meta me proíbe e me cobra.
  meta_cloud: {
    freeformOutsideWindow: false,
    requiresTemplates: true,
    // A Graph API cria e edita definições; o repo hoje só ESPELHA, e é essa
    // lacuna que a capability torna visível em vez de deixar implícita.
    canManageTemplates: true,
    banRisk: false,
    minIntervalMs: 6000,
    voiceNote: "opus-only",
    groups: "limited",
    costPerMessage: true,
  },
  // Mesma hetero-restrição do canal oficial, por baixo: é um BSP: a WABA é da
  // Meta, os templates são aprovados pela Meta e a janela de 24h é da Meta. O
  // intermediário muda o TRANSPORTE (quem endereça, como se autentica), não o
  // que o WhatsApp permite — e capability descreve o permitido, não o encanamento.
  //
  // As duas diferenças reais, medidas na doc do provider, não na intuição:
  //
  //  - `voiceNote: "opus-only"`. O provider tem um `voiceNote: true` no envio,
  //    mas exige ogg/opus mono explicitamente e NÃO converte — mesma restrição
  //    do canal oficial. Ler o campo booleano como "ele resolve para mim" é o
  //    erro que manda mp3 e entrega anexo de música.
  //  - `groups: "limited"`. Existe API de grupos, mas só em plano de uso e só
  //    para números fora de coexistência. Capability é o que a instalação MÉDIA
  //    pode fazer; prometer "full" aqui quebraria em quem não paga o plano.
  // `freeformOutsideWindow: false` está MEDIDO, não deduzido. A API aceita o
  // envio livre (200 + wamid) e a Meta recusa a ENTREGA depois, pelo webhook:
  //
  //   131047 Re-engagement message — "The 24-hour customer service window for
  //   this contact is closed. Send an approved template to re-open the
  //   conversation, or wait for the contact to message you first."
  //
  // O detalhe que engana: mandar um template NÃO abre a janela. Só o cliente
  // abre, respondendo. Quem ler o 200 como "enviado" acha que funciona.
  zernio: {
    freeformOutsideWindow: false,
    requiresTemplates: true,
    canManageTemplates: true,
    banRisk: false,
    minIntervalMs: 6000,
    voiceNote: "opus-only",
    groups: "limited",
    costPerMessage: true,
  },
  // Intermediário de CONTA, e o primeiro canal cuja resposta depende da SESSÃO e
  // não do provider: a mesma conta hospeda instância oficial (janela de 24h,
  // template aprovado) e número ligado por QR (texto livre, risco de
  // banimento). Quem sabe qual é qual é `provider_mode`, e quem responde certo é
  // `capabilitiesOfSession`.
  //
  // Esta linha é o que sobra quando a modalidade NÃO foi gravada, e por isso ela
  // é a CONSERVADORA EM CADA EIXO, não a média nem a mais provável:
  //
  //   freeformOutsideWindow: false + requiresTemplates: true  → do lado oficial,
  //     porque prometer texto livre onde a Meta recusa a ENTREGA faz a mensagem
  //     sumir sem erro visível, com o cliente esperando.
  //   banRisk: true + minIntervalMs                           → do lado do QR,
  //     porque desarmar throttle e warm-up num número que PODE ser banido
  //     custa o número inteiro, e não uma mensagem.
  //
  // Ou seja: os dois eixos erram para o lado seguro ao mesmo tempo, ainda que
  // essa combinação não descreva nenhuma instância real. É de propósito — o
  // fallback existe para não fazer estrago, não para adivinhar.
  stevo: {
    freeformOutsideWindow: false,
    requiresTemplates: true,
    canManageTemplates: true,
    banRisk: true,
    minIntervalMs: 6000,
    voiceNote: "opus-only",
    groups: "limited",
    costPerMessage: true,
  },
};

/**
 * As capacidades por MODALIDADE, para os providers que hospedam mais de uma.
 *
 * Só entra aqui quem de fato tem duas caras. Um `Record<ChannelProvider, …>`
 * completo obrigaria a inventar duas linhas idênticas para os canais de
 * modalidade única — e duas cópias da mesma verdade divergem na primeira
 * mudança.
 */
const CAPACIDADES_POR_MODO: Partial<
  Record<ChannelProvider, Record<ChannelMode, ChannelCapabilities>>
> = {
  stevo: {
    // Instância oficial: por baixo é a WABA da Meta. A janela de 24h e os
    // templates aprovados são da Meta, não do intermediário.
    oficial: {
      freeformOutsideWindow: false,
      requiresTemplates: true,
      canManageTemplates: true,
      banRisk: false,
      minIntervalMs: 6000,
      voiceNote: "opus-only",
      groups: "limited",
      costPerMessage: true,
    },
    // Número ligado por QR na conta dele: é o WhatsApp comum, com tudo o que
    // isso implica — sem janela, sem template, e com risco de banimento por
    // volume. O anti-ban PRECISA estar armado aqui.
    qr: {
      freeformOutsideWindow: true,
      requiresTemplates: false,
      // Não há WABA por trás: não existe definição aprovada para gerir.
      canManageTemplates: false,
      banRisk: true,
      minIntervalMs: null,
      // O intermediário exige ogg/opus e NÃO converte — ao contrário do
      // transporte próprio, que converte. Medido na doc dele, não deduzido da
      // modalidade: "é por QR" não implica "alguém converte para mim".
      voiceNote: "opus-only",
      groups: "limited",
      costPerMessage: true,
    },
  },
};

/**
 * O que assumir quando o banco NÃO diz qual é o canal — só quando a linha de
 * `channel_sessions` não pôde ser lida (a coluna é `not null default 'waha'`,
 * então uma sessão que existe sempre responde).
 *
 * Espelha o default da coluna de propósito: é o que mantém o comportamento
 * idêntico ao dos literais que as Tasks 4b/5 deixaram no código. E é o canal
 * CONSERVADOR dos dois — banRisk armado, throttle e warm-up ligados; errar para
 * o lado do meta_cloud desarmaria o anti-ban num número que pode ser banido.
 */
export const DEFAULT_CHANNEL_PROVIDER: ChannelProvider = "waha";

/**
 * Constantes nomeadas dos providers. Existem para que nenhum arquivo fora deste
 * módulo precise escrever a string — é o que o `scripts/lint-channels.ts` cobra.
 */
export const CHANNEL_PROVIDER_WAHA: ChannelProvider = "waha";
export const CHANNEL_PROVIDER_META: ChannelProvider = "meta_cloud";
export const CHANNEL_PROVIDER_ZERNIO: ChannelProvider = "zernio";
export const CHANNEL_PROVIDER_STEVO: ChannelProvider = "stevo";

export function capabilitiesOf(provider: ChannelProvider): ChannelCapabilities {
  const caps = CHANNEL_CAPABILITIES[provider];
  // Fail-closed: provider fora da matriz não herda o default do WAHA. O tipo
  // barra em compilação; isto barra o que vem do banco em runtime.
  if (!caps) throw new Error(`unknown_channel_provider: ${provider}`);
  return caps;
}

/**
 * O que ESTA SESSÃO permite — a pergunta certa quando se tem uma linha em mãos.
 *
 * ─── Por que `capabilitiesOf(provider)` não basta mais ─────────────────────
 *
 * Porque um provider passou a ter duas caras. A mesma conta intermediada
 * hospeda instância oficial (janela de 24h, fora dela só modelo aprovado) e
 * número ligado por QR (texto livre, risco de banimento) — regras OPOSTAS. Uma
 * função que só recebe o provider responderia a mesma coisa para as duas e
 * estaria errada em metade dos canais.
 *
 * ─── Quando usar cada uma ──────────────────────────────────────────────────
 *
 * `capabilitiesOfSession` sempre que houver uma linha de `channel_sessions`
 * (envio, cadeia `before_send`, janela na tela). `capabilitiesOf` continua para
 * quem só tem o provider — uma decisão sobre o canal em abstrato, antes de haver
 * sessão escolhida.
 *
 * Modo ausente cai na linha do provider, que é a CONSERVADORA em cada eixo. Não
 * é o caso comum e não deveria acontecer com a 0206 aplicada; é o que segura um
 * clone atrasado sem transformar "não sei" em "pode tudo".
 */
export function capabilitiesOfSession(sessao: {
  provider: ChannelProvider;
  mode?: ChannelMode | string | null;
}): ChannelCapabilities {
  const porModo = CAPACIDADES_POR_MODO[sessao.provider];
  if (porModo && (sessao.mode === "oficial" || sessao.mode === "qr")) {
    return porModo[sessao.mode];
  }
  return capabilitiesOf(sessao.provider);
}
