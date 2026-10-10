/**
 * Nosso envelope de saída → o corpo de mensagem da **WhatsApp Cloud API**.
 *
 * Vive fora de `adapters/` porque tem DOIS consumidores, e não um: o canal
 * oficial fala com `graph.facebook.com` direto, e o intermediário de conta, na
 * modalidade oficial, fala com um gateway que aceita "qualquer payload válido
 * da Cloud API, **sem** `messaging_product` (o gateway adiciona)". O miolo é o
 * mesmo objeto; o que muda é o envelope em volta e para onde vai.
 *
 * Por isso esta função devolve SÓ o miolo — `{ type, text|image|audio|… }` — e
 * nunca `to`, `messaging_product` ou `recipient_type`. Quem chama monta a volta,
 * porque a volta é justamente onde os dois destinos divergem. Uma versão que
 * devolvesse o corpo inteiro obrigaria o gateway a apagar um campo depois, e
 * apagar campo de payload alheio é o tipo de conserto que ninguém encontra.
 *
 * ⚠️ Duplicar isto num segundo arquivo é o anti-pattern nº 2 do `CLAUDE.md`
 * (duplicação sem fonte da verdade declarada): as duas cópias divergiriam na
 * primeira vez que um dos lados ganhasse um tipo de mídia.
 */
import { metaContactsPayload } from "@/lib/channels/meta/contact-card";
import { BOTAO_PADRAO_DA_LISTA, cortar, linhaDeLista } from "../opcoes-interativas";
import type { OutboundEnvelope } from "../types";

/**
 * `kind: "list"` → lista interativa da Cloud API.
 *
 * Só lista: a Graph API não tem enquete, e a capability já rebaixou o pedido
 * antes de chegar aqui. Limites da Meta (recusa com 400 acima deles): corpo
 * 1024, botão 20, título de seção e de linha 24, descrição de linha 72.
 */
function corpoDeLista(env: OutboundEnvelope): Record<string, unknown> | null {
  if (env.kind !== "list" || !env.opcoes) return null;
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: cortar(env.opcoes.pergunta, 1024) },
      action: {
        button: cortar(env.opcoes.botao ?? BOTAO_PADRAO_DA_LISTA, 20),
        sections: [
          {
            title: "Opções",
            rows: env.opcoes.opcoes.map((o) => {
              const linha = linhaDeLista(o, { titulo: 24, descricao: 72 });
              // `id` é o NOSSO id da opção — volta em `list_reply.id`.
              return {
                id: linha.id,
                title: linha.titulo,
                ...(linha.descricao ? { description: linha.descricao } : {}),
              };
            }),
          },
        ],
      },
    },
  };
}

/** `kind: "contact"` → objeto `contacts` da Cloud API. */
function corpoDeContato(env: OutboundEnvelope): Record<string, unknown> | null {
  if (env.kind !== "contact" || !env.contact) return null;
  return {
    type: "contacts",
    contacts: metaContactsPayload(env.contact.fullName, env.contact.phoneNumber),
  };
}

/** `kind` do envelope → objeto de mídia da Cloud API. */
function corpoDeMidia(env: OutboundEnvelope): Record<string, unknown> | null {
  if (!env.media) return null;
  const link = env.media.url;
  const caption = env.media.caption ?? undefined;

  switch (env.kind) {
    case "image":
      return { type: "image", image: { link, ...(caption ? { caption } : {}) } };
    case "video":
      return { type: "video", video: { link, ...(caption ? { caption } : {}) } };
    case "audio":
      // `voice: true` é o que faz virar BOLHA DE VOZ. Sem ele, anexo de música.
      // Exige ogg/opus — a Meta não converte, diferente do canal por QR.
      return { type: "audio", audio: { link, voice: true } };
    default:
      return {
        type: "document",
        document: {
          link,
          ...(env.media.filename ? { filename: env.media.filename } : {}),
          ...(caption ? { caption } : {}),
        },
      };
  }
}

/**
 * O miolo do corpo, na ordem em que os casos se excluem: cartão de contato,
 * mídia, e texto como último recurso — que é também o caso comum.
 */
export function corpoCloudApi(env: OutboundEnvelope): Record<string, unknown> {
  return (
    corpoDeContato(env) ??
    corpoDeLista(env) ??
    corpoDeMidia(env) ?? { type: "text", text: { body: env.body ?? "" } }
  );
}
