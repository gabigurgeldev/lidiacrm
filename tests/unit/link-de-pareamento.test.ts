/**
 * O LINK PÚBLICO DE PAREAMENTO — a porta sem sessão.
 *
 * ## Por que este arquivo é sobre segurança, e não sobre funcionalidade
 *
 * Quem abre o link **pareia um WhatsApp na operação de um cliente**. Não há
 * cookie, não há segundo fator: o token É a credencial. Então o que precisa
 * estar preso não é "o QR aparece" — é o conjunto de estados em que ele NÃO
 * pode aparecer, e o fato de que um token morto e um token que nunca existiu
 * respondem igual para fora.
 *
 * ## A asserção que carrega o arquivo
 *
 * `desconhecido` para tudo que não existe. Distinguir "nunca existiu" de "já
 * existiu e morreu" transformaria a rota pública num oráculo: quem varre tokens
 * saberia quais já existiram, e "existiu" é a metade difícil de adivinhar em
 * 192 bits.
 */
import { describe, expect, it, vi } from "vitest";

import {
  lerLinkDePareamento,
  segundosAteExpirar,
  VALIDADE_DO_LINK_MS,
} from "@/lib/channels/pareamento/link";

const AGORA = new Date("2026-09-03T12:00:00.000Z");
const TOKEN = "a".repeat(48);

function admin(resposta: { data: unknown; error: unknown }) {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update", "maybeSingle"]) {
    cadeia[m] = () => (m === "maybeSingle" ? Promise.resolve(resposta) : cadeia);
  }
  return { from: () => cadeia } as never;
}

const linhaViva = {
  id: "link-1",
  organization_id: "org-1",
  channel_session_id: "canal-1",
  expires_at: new Date(AGORA.getTime() + 10 * 60_000).toISOString(),
  consumed_at: null,
  revoked_at: null,
};

describe("lerLinkDePareamento — o que NÃO pode passar", () => {
  it("⭐ token expirado não vale, mesmo existindo no banco", async () => {
    const r = await lerLinkDePareamento(
      admin({
        data: { ...linhaViva, expires_at: new Date(AGORA.getTime() - 1000).toISOString() },
        error: null,
      }),
      TOKEN,
      AGORA,
    );
    expect(r).toEqual({ ok: false, motivo: "expirado" });
  });

  it("⭐ token JÁ USADO não vale — é o que implementa 'morre ao conectar'", async () => {
    const r = await lerLinkDePareamento(
      admin({ data: { ...linhaViva, consumed_at: AGORA.toISOString() }, error: null }),
      TOKEN,
      AGORA,
    );
    expect(r).toEqual({ ok: false, motivo: "usado" });
  });

  it("⭐ token cancelado não vale", async () => {
    const r = await lerLinkDePareamento(
      admin({ data: { ...linhaViva, revoked_at: AGORA.toISOString() }, error: null }),
      TOKEN,
      AGORA,
    );
    expect(r).toEqual({ ok: false, motivo: "cancelado" });
  });

  it("⭐ cancelado VENCE consumido — um link revogado não vira 'usado'", async () => {
    // A ordem importa: quem cancelou precisa ver que cancelou.
    const r = await lerLinkDePareamento(
      admin({
        data: { ...linhaViva, revoked_at: AGORA.toISOString(), consumed_at: AGORA.toISOString() },
        error: null,
      }),
      TOKEN,
      AGORA,
    );
    expect(r).toEqual({ ok: false, motivo: "cancelado" });
  });

  it("⭐ token inexistente responde 'desconhecido' — nunca 'expirado'", async () => {
    // Se a rota dissesse "expirado" para um token que nunca existiu, ela estaria
    // confirmando que ele já existiu. É o oráculo que o cabeçalho descreve.
    const r = await lerLinkDePareamento(admin({ data: null, error: null }), TOKEN, AGORA);
    expect(r).toEqual({ ok: false, motivo: "desconhecido" });
  });

  it("⭐ token curto é recusado ANTES de ir ao banco", async () => {
    const cliente = { from: vi.fn() };
    const r = await lerLinkDePareamento(cliente as never, "abc", AGORA);
    expect(r).toEqual({ ok: false, motivo: "desconhecido" });
    // Varredura não paga uma consulta por tentativa.
    expect(cliente.from).not.toHaveBeenCalled();
  });

  it("⭐ erro de banco LANÇA — não vira 'link inválido'", async () => {
    // Um banco fora do ar respondendo "link inválido" mandaria o cliente pedir
    // link novo a cada tentativa, para sempre, por um problema que não é dele.
    await expect(
      lerLinkDePareamento(
        admin({ data: null, error: { code: "08006", message: "connection failure" } }),
        TOKEN,
        AGORA,
      ),
    ).rejects.toThrow(/pairing_link_lookup_failed/u);
  });

  it("link vivo passa, e traz a organização DO TOKEN", async () => {
    const r = await lerLinkDePareamento(admin({ data: linhaViva, error: null }), TOKEN, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // `organization_id` sai daqui, nunca da URL — a regra de todo handler que
      // usa service role.
      expect(r.link.organizationId).toBe("org-1");
      expect(r.link.channelSessionId).toBe("canal-1");
    }
  });
});

describe("prazo", () => {
  it("são 30 minutos", () => {
    expect(VALIDADE_DO_LINK_MS).toBe(30 * 60 * 1000);
  });

  it("⭐ o contador nunca fica negativo — a tela mostra este número", () => {
    const passado = new Date(AGORA.getTime() - 60_000).toISOString();
    expect(segundosAteExpirar(passado, AGORA)).toBe(0);
  });

  it("conta os segundos que faltam", () => {
    const futuro = new Date(AGORA.getTime() + 90_000).toISOString();
    expect(segundosAteExpirar(futuro, AGORA)).toBe(90);
  });
});
