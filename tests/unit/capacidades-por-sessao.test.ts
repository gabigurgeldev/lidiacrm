/**
 * O MESMO PROVIDER COM DUAS REGRAS DE ENVIO OPOSTAS.
 *
 * ## Por que `capabilitiesOf(provider)` deixou de bastar
 *
 * Até o quarto canal, a modalidade era dedutível da identidade: um provider
 * pareia por QR (texto livre, risco de banimento), os outros são oficiais
 * (janela de 24h, fora dela só modelo aprovado). O intermediário de CONTA quebra
 * isso — a mesma conta hospeda os dois tipos de instância, e a API dele responde
 * `is_official_api` por instância.
 *
 * Uma função que só recebe o provider responderia a MESMA coisa para as duas e
 * estaria errada em metade dos canais dele. Os dois erros custam caro e em
 * direções diferentes:
 *
 *   - tratar QR como oficial → trava envio de texto livre num número que não tem
 *     janela nenhuma; o atendente não consegue responder e não entende por quê.
 *   - tratar oficial como QR → libera texto livre fora da janela; a API aceita
 *     (200 + id) e a Meta recusa a ENTREGA depois, pelo webhook. A mensagem some
 *     sem erro visível, com o cliente esperando.
 *
 * ## A asserção que carrega o arquivo
 *
 * Modo AUSENTE cai no conservador em CADA eixo — não na média, não no mais
 * provável. É o caso do clone que ainda não aplicou a 0206, e é onde uma
 * implementação descuidada escolheria "o mais comum" e desarmaria o anti-ban.
 */
import { describe, expect, it } from "vitest";

import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_STEVO,
  CHANNEL_PROVIDER_WAHA,
  capabilitiesOf,
  capabilitiesOfSession,
} from "@/lib/channels/capabilities";

describe("a mesma origem, modalidades diferentes", () => {
  it("⭐ instância oficial tem janela de 24h e NÃO tem risco de banimento", () => {
    const c = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: "oficial" });
    expect(c.freeformOutsideWindow).toBe(false);
    expect(c.requiresTemplates).toBe(true);
    expect(c.banRisk).toBe(false);
  });

  it("⭐ número por QR é o OPOSTO: texto livre sempre, e anti-ban armado", () => {
    const c = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: "qr" });
    expect(c.freeformOutsideWindow).toBe(true);
    expect(c.requiresTemplates).toBe(false);
    expect(c.banRisk).toBe(true);
    // Sem WABA por trás não há definição aprovada para gerir — oferecer o botão
    // "criar modelo" aqui mandaria o operador para uma tela que não funciona.
    expect(c.canManageTemplates).toBe(false);
  });

  it("as duas modalidades discordam em pelo menos um eixo de cada risco", () => {
    // Guarda contra o conserto preguiçoso: alguém apontar as duas para o mesmo
    // objeto faria os dois casos acima passarem se as constantes coincidissem.
    const oficial = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: "oficial" });
    const qr = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: "qr" });
    expect(oficial.freeformOutsideWindow).not.toBe(qr.freeformOutsideWindow);
    expect(oficial.banRisk).not.toBe(qr.banRisk);
  });
});

describe("quando o modo não foi gravado", () => {
  it("⭐ cai no CONSERVADOR em cada eixo, e não no mais provável", () => {
    // O clone que ainda não aplicou a 0206 chega aqui. Errar para o lado seguro
    // nos DOIS eixos ao mesmo tempo não descreve nenhuma instância real — é de
    // propósito: o fallback existe para não fazer estrago, não para adivinhar.
    const c = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: null });
    expect(c.freeformOutsideWindow).toBe(false); // lado oficial: não promete o que a Meta recusa
    expect(c.banRisk).toBe(true); // lado do QR: anti-ban armado
  });

  it("modo desconhecido não vira 'oficial' por parecer com ele", () => {
    const c = capabilitiesOfSession({ provider: CHANNEL_PROVIDER_STEVO, mode: "OFICIAL" });
    expect(c.banRisk).toBe(true);
  });
});

describe("os canais de modalidade única não mudam", () => {
  it("um modo passado por engano não altera quem não tem modalidade", () => {
    // Ninguém deveria passar modo para estes, mas a defesa é barata: se algum dia
    // o campo for preenchido por engano numa linha de outro provider, a resposta
    // continua sendo a do provider.
    expect(capabilitiesOfSession({ provider: CHANNEL_PROVIDER_WAHA, mode: "oficial" })).toEqual(
      capabilitiesOf(CHANNEL_PROVIDER_WAHA),
    );
    expect(capabilitiesOfSession({ provider: CHANNEL_PROVIDER_META, mode: "qr" })).toEqual(
      capabilitiesOf(CHANNEL_PROVIDER_META),
    );
  });
});
