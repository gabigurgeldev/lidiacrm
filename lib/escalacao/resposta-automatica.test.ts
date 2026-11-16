import { describe, expect, it } from "vitest";

import {
  JANELA_DA_RESPOSTA_AUTOMATICA_S,
  MIN_CONVERSAS_DA_AUTOMATICA,
  pareceRespostaAutomatica,
  type EnvioAnteriorDoMesmoTexto,
} from "./celular-da-loja";

/**
 * A saudação e a mensagem de ausência do WhatsApp Business saem do PRÓPRIO
 * aparelho da loja, e o webhook as entrega como qualquer mensagem digitada no
 * celular. Medido numa instalação real (nov/2026): a saudação saiu em ≤15 s
 * depois da cliente em 179 de 193 conversas, a ausência em 138 de 162 — e cada
 * uma pausava a IA antes de ela falar. Em 13 dias a agente não respondeu
 * ninguém.
 *
 * A resposta pronta que a atendente manda à mão ("Para agendarmos seu horário…")
 * também se repete, mas saiu rápida em só 7 de 54 conversas. A diferença que
 * separa as duas é a PROPORÇÃO, não a repetição — e por isso o controle abaixo.
 */

function envios(rapidas: number, lentas: number): EnvioAnteriorDoMesmoTexto[] {
  const r: EnvioAnteriorDoMesmoTexto[] = [];
  for (let i = 0; i < rapidas; i += 1) r.push({ conversation_id: `r${i}`, segundos_apos_cliente: 1 });
  for (let i = 0; i < lentas; i += 1) r.push({ conversation_id: `l${i}`, segundos_apos_cliente: 600 });
  return r;
}

describe("pareceRespostaAutomatica", () => {
  it("saudação do WhatsApp Business (rápida em quase toda conversa) → automática", () => {
    expect(pareceRespostaAutomatica({ segundosAposCliente: 1, anteriores: envios(179, 14) })).toBe(true);
  });

  it("controle: resposta pronta digitada pela atendente (rápida às vezes) → humana", () => {
    expect(pareceRespostaAutomatica({ segundosAposCliente: 1, anteriores: envios(7, 47) })).toBe(false);
  });

  it("controle: texto curto comum ('Tá bom') → humana", () => {
    expect(pareceRespostaAutomatica({ segundosAposCliente: 2, anteriores: envios(7, 27) })).toBe(false);
  });

  it("o MESMO texto da saudação, mas mandado minutos depois da cliente → humana", () => {
    expect(
      pareceRespostaAutomatica({
        segundosAposCliente: JANELA_DA_RESPOSTA_AUTOMATICA_S + 1,
        anteriores: envios(179, 14),
      }),
    ).toBe(false);
  });

  it("sem saber quando a cliente escreveu → humana (na dúvida, a pausa vale)", () => {
    expect(pareceRespostaAutomatica({ segundosAposCliente: null, anteriores: envios(179, 14) })).toBe(false);
  });

  it("antes de aprender: menos conversas que o mínimo → humana", () => {
    expect(
      pareceRespostaAutomatica({
        segundosAposCliente: 1,
        anteriores: envios(MIN_CONVERSAS_DA_AUTOMATICA - 1, 0),
      }),
    ).toBe(false);
    expect(
      pareceRespostaAutomatica({ segundosAposCliente: 1, anteriores: envios(MIN_CONVERSAS_DA_AUTOMATICA, 0) }),
    ).toBe(true);
  });

  it("conta CONVERSAS, não mensagens: a mesma saudação repetida numa conversa só não ensina nada", () => {
    const umaSo = Array.from({ length: 20 }, () => ({ conversation_id: "c1", segundos_apos_cliente: 1 }));
    expect(pareceRespostaAutomatica({ segundosAposCliente: 1, anteriores: umaSo })).toBe(false);
  });
});
