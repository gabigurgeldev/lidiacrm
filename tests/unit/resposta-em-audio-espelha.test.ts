/**
 * Responder em áudio × espelhar o cliente (migrations 0222 + 0226).
 *
 * Medido em produção (2026-10-06): "oi bom dia" escrito recebia nota de voz. O
 * espelho faz texto receber texto e áudio receber áudio — sem mudar quem já
 * tinha ligado o "sempre em áudio" (default do espelho é desligado).
 */
import { describe, expect, it, vi } from "vitest";

import {
  clienteMandouAudioDesdeAUltimaResposta,
  decidirRespostaEmAudio,
} from "@/lib/agent-engine/agent/resposta-em-audio";

describe("decidirRespostaEmAudio", () => {
  it.each([
    // replyAsAudio, espelhar, clienteMandouAudio → áudio?
    [false, false, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [true, false, true, true],
    [true, true, false, false],
    [true, true, true, true],
  ])("voz=%s espelho=%s cliente-em-áudio=%s → %s", (replyAsAudio, espelhar, clienteMandouAudio, esperado) => {
    expect(decidirRespostaEmAudio({ replyAsAudio, espelhar, clienteMandouAudio })).toBe(esperado);
  });
});

describe("clienteMandouAudioDesdeAUltimaResposta", () => {
  it("pergunta só pelo lote que este turno responde: áudio RECEBIDO depois da última saída, na org e conversa certas", async () => {
    const query = vi.fn(async () => ({ rows: [{ ha: true }] }));
    const r = await clienteMandouAudioDesdeAUltimaResposta({ query } as never, "org-1", "conv-1");
    expect(r).toBe(true);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(["org-1", "conv-1"]);
    expect(sql).toMatch(/m\.organization_id = \$1/);
    expect(sql).toMatch(/m\.direction = 'inbound'/);
    expect(sql).toMatch(/m\.type = 'audio'/);
    expect(sql).toMatch(/o\.direction = 'outbound'/);
  });

  it("sem linha, não há áudio", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await clienteMandouAudioDesdeAUltimaResposta({ query } as never, "o", "c")).toBe(false);
  });
});
