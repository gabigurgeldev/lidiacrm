/**
 * UMA CHAVE, VÁRIOS NÚMEROS — a descoberta e a importação.
 *
 * ## O que esta forma de conectar tem de diferente
 *
 * As outras duas pedem credencial POR NÚMERO. Esta emite chave de CONTA, e com
 * ela o CRM pergunta "quais números você tem?" e recebe a lista — oficiais e por
 * QR misturados. O operador escolhe; não redigita nada.
 *
 * ## As asserções que carregam o arquivo
 *
 * 1. **`is_official_api` vira `provider_mode`.** É o único momento em que o
 *    provedor conta a modalidade, e é ela que decide a regra de envio: janela de
 *    24h de um lado, anti-ban do outro. Perder essa tradução aqui faz o canal
 *    nascer com a regra errada e ninguém percebe até a mensagem não sair.
 * 2. **Chave recusada NÃO grava nada.** Gravar primeiro e descobrir depois é o
 *    que faz o operador achar que conectou.
 * 3. **Webhook recusado não desfaz a importação, mas é REPORTADO.** O canal
 *    envia e não recebe — o defeito mais confuso possível se ficar calado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: vi.fn() }));
vi.mock("@/lib/channels/reactivate", () => ({
  reactivateChannelSession: vi.fn(async () => ({ error: null })),
}));

import {
  importarInstancias,
  validarContaDeInstancias,
  type InstanciaDaConta,
} from "@/lib/channels/conta-de-instancias";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { reactivateChannelSession } from "@/lib/channels/reactivate";

const ORG = "11111111-1111-4111-8111-111111111111";

type Linha = Record<string, unknown>;

/** Banco falso mínimo: honra `.eq`, registra escritas. */
function makeDb(linhas: Linha[] = []) {
  const escritas: Array<{ tipo: "insert" | "update"; patch: Linha }> = [];

  class Q implements PromiseLike<unknown> {
    private filtros: Array<[string, unknown]> = [];
    private negados: Array<[string, unknown]> = [];
    private unica = false;
    constructor(
      private readonly op: "select" | "insert",
      private readonly patch: Linha | null = null,
    ) {}
    select(): this {
      return this;
    }
    eq(c: string, v: unknown): this {
      this.filtros.push([c, v]);
      return this;
    }
    is(c: string, v: unknown): this {
      this.filtros.push([c, v]);
      return this;
    }
    /**
     * `.not("archived_at", "is", null)` — o outro lado da partição.
     *
     * O banco falso guarda o filtro como "quero as arquivadas", porque a
     * importação usa esta cadeia para achar a linha a RESSUSCITAR. Sem
     * implementá-lo, a busca da arquivada devolveria as mesmas linhas da busca
     * das ativas e o teste mediria o contrário do que quer.
     */
    not(c: string, _op: string, v: unknown): this {
      this.negados.push([c, v]);
      return this;
    }
    order(): this {
      return this;
    }
    limit(): this {
      return this;
    }
    maybeSingle(): this {
      this.unica = true;
      return this;
    }
    private casam(): Linha[] {
      return linhas.filter(
        (l) =>
          this.filtros.every(([c, v]) => (l[c] ?? null) === v) &&
          this.negados.every(([c, v]) => (l[c] ?? null) !== v),
      );
    }
    then<R1 = unknown, R2 = never>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
      onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      if (this.op === "select") {
        const achadas = this.casam();
        return Promise.resolve({
          data: this.unica ? (achadas[0] ?? null) : achadas,
          error: null,
        }).then(onOk, onErr);
      }
      escritas.push({ tipo: "insert", patch: this.patch ?? {} });
      const nova = { id: `linha-${linhas.length}`, webhook_path_token: "tok-novo", ...(this.patch ?? {}) };
      linhas.push(nova);
      return Promise.resolve({ data: nova, error: null }).then(onOk, onErr);
    }
  }

  const client = {
    from: () => ({
      select: () => new Q("select"),
      insert: (patch: Linha) => new Q("insert", patch),
    }),
  };
  return { client, escritas, linhas };
}

const instancia = (over: Partial<InstanciaDaConta> = {}): InstanciaDaConta => ({
  id: "inst-1",
  nome: "Vendas",
  telefone: "5531999998888",
  situacao: "connected",
  conectada: true,
  modo: "oficial",
  importada: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(encryptWebhookSecret).mockResolvedValue("cifra" as never);
});

describe("descobrir os números da conta", () => {
  it("⭐ traduz a modalidade do provedor no vocabulário que decide a regra de envio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "a", name: "Oficial", is_official_api: true, connected: true, phone_number: "551111" },
              { id: "b", name: "Por QR", is_official_api: false, connected: false },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { client } = makeDb();
    const r = await validarContaDeInstancias(client as never, { organizationId: ORG, apiKey: "k" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.instancias.map((i) => i.modo)).toEqual(["oficial", "qr"]);
  });

  it("⭐ campo AUSENTE não vira oficial por acidente", () => {
    // Uma versão antiga da API, ou um erro de serialização, faria o canal nascer
    // com texto livre liberado onde a Meta recusa a entrega. Na dúvida, não é
    // oficial: o pior que acontece é o aviso de janela aparecer sem precisar.
    return (async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify([{ id: "a", name: "Sem campo" }]), { status: 200 })),
      );
      const { client } = makeDb();
      const r = await validarContaDeInstancias(client as never, { organizationId: ORG, apiKey: "k" });
      expect(r.ok && r.instancias[0]?.modo).toBe("qr");
    })();
  });

  it("marca o que JÁ está aqui, para a tela não oferecer de novo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ id: "a" }, { id: "b" }]), { status: 200 }),
      ),
    );
    const { client } = makeDb([
      { organization_id: ORG, provider: "stevo", stevo_instance_id: "a", archived_at: null },
    ]);
    const r = await validarContaDeInstancias(client as never, { organizationId: ORG, apiKey: "k" });
    expect(r.ok && r.instancias.map((i) => i.importada)).toEqual([true, false]);
  });

  it("⭐ chave recusada devolve motivo — e nada é gravado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { client, escritas } = makeDb();
    const r = await validarContaDeInstancias(client as never, { organizationId: ORG, apiKey: "errada" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/recusada/);
    expect(escritas).toEqual([]);
  });

  it("rede caída e chave errada dão mensagens DIFERENTES", async () => {
    // As ações são opostas — tentar de novo mais tarde versus buscar outra chave.
    // Uma mensagem só para os dois manda o operador para o caminho errado metade
    // das vezes.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { client } = makeDb();
    const r = await validarContaDeInstancias(client as never, { organizationId: ORG, apiKey: "k" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).not.toMatch(/recusada/);
    expect(r.motivo).toMatch(/conex/i);
  });
});

describe("importar", () => {
  it("⭐ grava a modalidade na linha — é o que decide a regra de envio depois", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { client, escritas } = makeDb();
    const r = await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia({ modo: "qr" })],
    });

    expect(r.ok).toBe(true);
    expect(escritas[0]?.patch.provider_mode).toBe("qr");
    expect(escritas[0]?.patch.organization_id).toBe(ORG);
  });

  it("aponta o webhook para a rota NEUTRA desta instalação", async () => {
    // Os parâmetros são DECLARADOS mesmo sem uso: `vi.fn(async () => …)` infere
    // a lista de argumentos como tupla VAZIA, e aí `mock.calls.at(-1)` não tem
    // índice 0 nem 1 — o teste compila no `tsc` solto e falha no
    // `tsconfig.typecheck.json`, que é o que o CI roda.
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client } = makeDb();
    await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia()],
    });

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toContain("/webhook");
    expect(init?.method).toBe("PUT");
    const corpo = JSON.parse(String(init?.body));
    expect(corpo.url).toBe("https://crm.exemplo/api/v1/webhooks/channel/tok-novo");
    // Sem `SEND_MESSAGE` a mensagem que o operador manda pelo CELULAR não chega
    // ao CRM, e a conversa fica pela metade.
    expect(corpo.events).toContain("SEND_MESSAGE");
  });

  it("⭐ webhook recusado NÃO desfaz a importação, mas é reportado", async () => {
    // O canal já envia. Um canal que envia e não recebe é ruim, mas é melhor que
    // canal nenhum — desde que a tela diga, que é para isso que `recebendo` sobe.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { client, escritas } = makeDb();
    const r = await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia()],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(escritas).toHaveLength(1);
    expect(r.desfechos[0]?.recebendo).toBe(false);
  });

  it("⭐ com uma linha ATIVA e uma ARQUIVADA do mesmo número, atualiza a ativa", async () => {
    // O índice único da 0206 é PARCIAL (`where archived_at is null`), então as
    // duas coexistem legitimamente — basta o operador ter excluído e reimportado.
    // Uma busca só, sem recorte, casaria as duas: `maybeSingle()` devolveria
    // `data: null` + PGRST116, o código leria "não existe" e tentaria INSERIR —
    // e aí a trava recusaria, com a importação falhando por erro de constraint
    // num caminho que deveria só atualizar.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { client, escritas } = makeDb([
      {
        id: "viva",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-viva",
        archived_at: null,
      },
      {
        id: "morta",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-morta",
        archived_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const r = await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia()],
    });

    expect(r.ok).toBe(true);
    // Nada inserido: o caminho tomado foi o de atualização, e sobre a linha VIVA.
    expect(escritas).toEqual([]);
    expect(reactivateChannelSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelSessionId: "viva" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("sem linha ativa, ressuscita a ARQUIVADA em vez de criar outra", async () => {
    // Criar outra deixaria a antiga segurando o histórico: as conversas velhas
    // apontam para ela, e o contato passaria a ter duas conversas paralelas.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { client, escritas } = makeDb([
      {
        id: "morta",
        organization_id: ORG,
        provider: "stevo",
        stevo_instance_id: "inst-1",
        webhook_path_token: "tok-morta",
        archived_at: "2026-01-01T00:00:00Z",
      },
    ]);

    await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia()],
    });

    expect(escritas).toEqual([]);
    expect(reactivateChannelSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelSessionId: "morta" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("sem cifra disponível, recusa em vez de gravar a chave em claro", async () => {
    vi.mocked(encryptWebhookSecret).mockResolvedValue(null as never);
    const { client, escritas } = makeDb();
    const r = await importarInstancias(client as never, {
      organizationId: ORG,
      userId: "u",
      requestId: "r",
      apiKey: "k",
      baseDoWebhook: "https://crm.exemplo",
      instancias: [instancia()],
    });

    expect(r.ok).toBe(false);
    expect(escritas).toEqual([]);
  });
});
