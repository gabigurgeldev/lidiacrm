/**
 * DISPARO EM MASSA COM IMAGEM OU VÍDEO — contrato e envio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarDisparoSchema } from "@/lib/schemas/bulk-sends";

const chamadas: unknown[][] = [];
vi.mock("@/app/api/v1/messages/_handler", () => ({
  sendMessageHandler: vi.fn(async (...args: unknown[]) => {
    chamadas.push(args);
    return { id: "m1", status: "sent" };
  }),
}));
vi.mock("@/lib/automation/start-conversation", () => ({
  ensureConversation: vi.fn(async () => "conv-1"),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { enviarUmDoDisparo } from "@/lib/bulk-send/enviar";
import type { DisparoEmVoo } from "@/lib/bulk-send/motor";

const base = {
  name: "Campanha",
  channel_session_id: "11111111-2222-4333-8444-555555555555",
  audiencia: { kind: "tags", tags: ["a"] },
};
const midia = { storage_path: "org/disparos/a.jpg", mime: "image/jpeg", kind: "image" };

describe("contrato", () => {
  it("texto livre aceita imagem ou vídeo", () => {
    expect(criarDisparoSchema.safeParse({ ...base, mode: "freeform", body: "Oi", midia }).success).toBe(true);
  });

  it("⭐ modelo aprovado NÃO aceita mídia anexada — a imagem é a do cabeçalho do modelo", () => {
    const r = criarDisparoSchema.safeParse({
      ...base,
      mode: "template",
      template_name: "promo",
      template_language: "pt_BR",
      midia,
    });
    expect(r.success).toBe(false);
  });

  it("tipo de mídia fora de imagem/vídeo é recusado", () => {
    const r = criarDisparoSchema.safeParse({
      ...base,
      mode: "freeform",
      body: "Oi",
      midia: { ...midia, kind: "audio" },
    });
    expect(r.success).toBe(false);
  });
});

const disparo: DisparoEmVoo = {
  id: "d1",
  organization_id: "org",
  channel_session_id: "s1",
  provider: "waha",
  mode: "freeform",
  body: "Promoção de hoje",
  template_name: null,
  template_language: null,
  template_values: {},
  interval_ms: 5000,
};

describe("envio de cada destinatário", () => {
  beforeEach(() => {
    chamadas.length = 0;
  });

  it("⭐ com vídeo: tipo do envio é o da mídia, o texto vai de legenda e o arquivo é o da campanha", async () => {
    await enviarUmDoDisparo(
      { ...disparo, media_storage_path: "org/disparos/v.mp4", media_mime: "video/mp4", media_kind: "video" },
      { id: "r1", contact_id: "c1" } as never,
    );
    const [, , entrada, opcoes] = chamadas[0]!;
    expect(entrada).toMatchObject({ conversation_id: "conv-1", type: "video", body: "Promoção de hoje" });
    expect(opcoes).toEqual({ midiaCompartilhada: { path: "org/disparos/v.mp4", mime: "video/mp4" } });
  });

  it("sem mídia: texto como sempre, sem opção de mídia", async () => {
    await enviarUmDoDisparo(disparo, { id: "r1", contact_id: "c1" } as never);
    const [, , entrada, opcoes] = chamadas[0]!;
    expect(entrada).toMatchObject({ type: "text", body: "Promoção de hoje" });
    expect(opcoes).toEqual({});
  });
});
