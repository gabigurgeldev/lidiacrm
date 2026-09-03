/**
 * RECONECTAR O WEBHOOK SEM REIMPORTAR.
 *
 * O import só registra o webhook UMA vez. Se a chave da conta não tinha o
 * escopo `instances:manage` naquele momento, o canal fica conectado e SURDO —
 * e sem esta rota a única saída seria colar a chave inteira de novo e
 * reimportar tudo. `reapontarWebhookDaConta` reaproveita a credencial já
 * gravada na linha (via `resolveStevoCreds`, mockado aqui — tem teste próprio)
 * e tenta o PUT de novo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CredentialsModule from "@/lib/channels/stevo/credentials";

vi.mock("@/lib/channels/stevo/credentials", async (importOriginal) => {
  const real = await importOriginal<typeof CredentialsModule>();
  return { ...real, resolveStevoCreds: vi.fn() };
});

import { reapontarWebhookDaConta } from "@/lib/channels/conta-de-instancias";
import { resolveStevoCreds } from "@/lib/channels/stevo/credentials";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;

/** Banco falso mínimo: só `channel_sessions.select().eq(...).is(...).maybeSingle()`. */
function makeDb(linhas: Linha[]) {
  class Q implements PromiseLike<unknown> {
    private filtros: Array<[string, unknown]> = [];
    eq(c: string, v: unknown): this {
      this.filtros.push([c, v]);
      return this;
    }
    is(c: string, v: unknown): this {
      this.filtros.push([c, v]);
      return this;
    }
    select(): this {
      return this;
    }
    maybeSingle(): this {
      return this;
    }
    then<R1 = unknown, R2 = never>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
      onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      const achada = linhas.find((l) => this.filtros.every(([c, v]) => (l[c] ?? null) === v)) ?? null;
      return Promise.resolve({ data: achada, error: null }).then(onOk, onErr);
    }
  }
  return { from: () => ({ select: () => new Q() }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("reapontarWebhookDaConta", () => {
  it("⭐ sucesso: reaproveita a credencial gravada, sem pedir a chave de novo", async () => {
    vi.mocked(resolveStevoCreds).mockResolvedValue({
      instanceId: "inst-1",
      apiKey: "stevo_sk_x",
      baseUrl: "https://openapi.stevo.chat",
      source: "session",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const admin = makeDb([
      {
        id: "cs-1",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-1",
        archived_at: null,
      },
    ]);

    const r = await reapontarWebhookDaConta(admin as never, {
      organizationId: ORG,
      channelSessionId: "cs-1",
      baseDoWebhook: "https://crm.exemplo",
    });

    expect(r.ok).toBe(true);
    expect(resolveStevoCreds).toHaveBeenCalledWith(admin, {
      organizationId: ORG,
      instanceId: "inst-1",
    });
  });

  it("canal de OUTRA organização não é encontrado — nunca vaza existência", async () => {
    const admin = makeDb([
      {
        id: "cs-1",
        organization_id: OUTRA_ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-1",
        archived_at: null,
      },
    ]);

    const r = await reapontarWebhookDaConta(admin as never, {
      organizationId: ORG,
      channelSessionId: "cs-1",
      baseDoWebhook: "https://crm.exemplo",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/não encontrado/);
    expect(resolveStevoCreds).not.toHaveBeenCalled();
  });

  it("canal inexistente devolve motivo, não lança", async () => {
    const admin = makeDb([]);
    const r = await reapontarWebhookDaConta(admin as never, {
      organizationId: ORG,
      channelSessionId: "cs-fantasma",
      baseDoWebhook: "https://crm.exemplo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/não encontrado/);
  });

  it("⭐ 403 do provedor chega inteiro até quem chamou", async () => {
    vi.mocked(resolveStevoCreds).mockResolvedValue({
      instanceId: "inst-1",
      apiKey: "stevo_sk_x",
      baseUrl: "https://openapi.stevo.chat",
      source: "session",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const admin = makeDb([
      {
        id: "cs-1",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-1",
        archived_at: null,
      },
    ]);

    const r = await reapontarWebhookDaConta(admin as never, {
      organizationId: ORG,
      channelSessionId: "cs-1",
      baseDoWebhook: "https://crm.exemplo",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/instances:manage|escopo|permiss/i);
  });

  it("sem credencial gravada (cifra indisponível) devolve motivo, não lança", async () => {
    vi.mocked(resolveStevoCreds).mockResolvedValue(null);
    const admin = makeDb([
      {
        id: "cs-1",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-1",
        archived_at: null,
      },
    ]);

    const r = await reapontarWebhookDaConta(admin as never, {
      organizationId: ORG,
      channelSessionId: "cs-1",
      baseDoWebhook: "https://crm.exemplo",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/credencial/);
  });
});
