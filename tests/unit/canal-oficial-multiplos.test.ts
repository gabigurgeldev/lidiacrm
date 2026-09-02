/**
 * VÁRIOS NÚMEROS OFICIAIS NA MESMA ORGANIZAÇÃO.
 *
 * ## O defeito que este arquivo fecha
 *
 * A rota nasceu singular: `maybeSingle()` na leitura e uma busca por
 * `(organização, provider)` na escrita. O efeito não era "o segundo número não
 * aparece" — era pior e silencioso. Quem tentasse conectar um segundo número da
 * Meta via o PRIMEIRO ser sobrescrito: a mesma linha recebia credencial nova,
 * `waba_id` novo e número novo, respondia 200, e a tela dizia "Conectado".
 *
 * A partir dali o canal antigo continuava recebendo webhook — o
 * `webhook_path_token` é da LINHA e não muda no update —, e tudo o que entrasse
 * pelo número antigo passava a ser respondido pelo novo. Não é falha de envio: é
 * a mensagem saindo pelo número errado, para o cliente certo.
 *
 * ## Por que o banco nunca foi o limite
 *
 * A migration 0165 criou um índice único PARCIAL sobre `meta_phone_number_id`
 * entre linhas ativas. Um índice único por NÚMERO só faz sentido se várias
 * linhas oficiais puderem coexistir: o schema já previa o que o código proibia.
 *
 * ## A asserção que carrega o arquivo
 *
 * `insere` vs `atualiza` decidido pelo `meta_phone_number_id`. É a única coisa
 * que separa "conectar mais um" de "trocar a credencial deste" — e as duas
 * chegam pelo MESMO POST, com o mesmo corpo, mudando um campo.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { validateMetaCredentials } from "@/lib/channels/meta/validate-credentials";
import { reactivateChannelSession } from "@/lib/channels/reactivate";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: vi.fn() }));
vi.mock("@/lib/channels/meta/validate-credentials", () => ({
  validateMetaCredentials: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/channels/reactivate", () => ({
  // A ressurreição tem teste próprio (`canal-arquivado-caminho-de-volta`); aqui
  // ela é só "o caminho do update", e o que importa é QUAL linha ele alcança —
  // por isso a asserção do caminho de atualização é sobre ESTE mock, e não sobre
  // as escritas do banco falso: o `update` de verdade acontece lá dentro.
  reactivateChannelSession: vi.fn(async () => ({ error: null })),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// Ids longos porque o schema da rota exige 5 caracteres no mínimo — "111" seria
// recusado com 422 antes de chegar ao banco, e o teste mediria a validação em
// vez do que ele quer medir.
const NUM_A = "1110000001";
const NUM_B = "2220000002";
const NUM_C = "3330000003";

type Linha = Record<string, unknown>;

interface Registro {
  linhas: Linha[];
  escritas: Array<{ tipo: "insert" | "update"; patch: Linha }>;
}

function makeDb(sessions: Linha[]): Registro {
  const linhas = [...sessions];
  const registro: Registro = { linhas, escritas: [] };

  class Q implements PromiseLike<unknown> {
    private filtros: Array<[string, unknown]> = [];
    private unica = false;

    constructor(
      private readonly op: "select" | "update" | "insert",
      private readonly patch: Linha | null = null,
    ) {}

    select(): this {
      return this;
    }
    eq(col: string, val: unknown): this {
      this.filtros.push([col, val]);
      return this;
    }
    is(col: string, val: unknown): this {
      this.filtros.push([col, val]);
      return this;
    }
    maybeSingle(): this {
      this.unica = true;
      return this;
    }

    private casam(): Linha[] {
      return linhas.filter((l) => this.filtros.every(([c, v]) => (l[c] ?? null) === v));
    }

    private executar(): { data: unknown; error: unknown } {
      if (this.op === "select") {
        const achadas = this.casam();
        return { data: this.unica ? (achadas[0] ?? null) : achadas, error: null };
      }
      registro.escritas.push({
        tipo: this.op === "insert" ? "insert" : "update",
        patch: this.patch ?? {},
      });
      if (this.op === "insert") {
        linhas.push({ id: `novo-${linhas.length}`, ...(this.patch ?? {}) });
      } else {
        for (const l of this.casam()) Object.assign(l, this.patch);
      }
      return { data: null, error: null };
    }

    then<R1 = unknown, R2 = never>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
      onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve(this.executar()).then(onOk, onErr);
    }
  }

  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      select: () => new Q("select"),
      update: (patch: Linha) => new Q("update", patch),
      insert: (patch: Linha) => new Q("insert", patch),
    }),
  } as never);

  return registro;
}

function oficial(phoneNumberId: string, over: Linha = {}): Linha {
  return {
    id: `canal-${phoneNumberId}`,
    organization_id: ORG,
    provider: CHANNEL_PROVIDER_META,
    meta_phone_number_id: phoneNumberId,
    meta_waba_id: "waba-1",
    meta_token_encrypted: "cifra-velha",
    phone_number: null,
    display_name: "Loja",
    webhook_path_token: `tok-${phoneNumberId}`,
    status: "WORKING",
    archived_at: null,
    ...over,
  };
}

const req = (corpo: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/v1/channels/official", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });

const CORPO_BASE = {
  waba_id: "9876543210",
  token: "EAA-token-de-teste-com-mais-de-vinte-caracteres",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG },
  } as never);
  vi.mocked(encryptWebhookSecret).mockResolvedValue("cifra-nova" as never);
  vi.mocked(validateMetaCredentials).mockResolvedValue({
    ok: true,
    displayPhoneNumber: "55 31 99999-8888",
    verifiedName: "Loja",
  } as never);
});

describe("POST — conectar mais um número não sobrescreve o anterior", () => {
  it("⭐ número DIFERENTE insere uma segunda linha", async () => {
    const db = makeDb([oficial(NUM_A)]);
    const { POST } = await import("@/app/api/v1/channels/official/route");
    const res = await POST(req({ ...CORPO_BASE, phone_number_id: NUM_B }));

    expect(res.status).toBe(200);
    expect(db.escritas.map((e) => e.tipo)).toEqual(["insert"]);
    expect(db.linhas).toHaveLength(2);
    // O primeiro número segue intacto: mesma credencial, mesmo id de número.
    expect(db.linhas[0]?.meta_token_encrypted).toBe("cifra-velha");
    expect(db.linhas[0]?.meta_phone_number_id).toBe(NUM_A);
  });

  it("número IGUAL atualiza a linha daquele número, sem criar outra", async () => {
    const db = makeDb([oficial(NUM_A)]);
    const { POST } = await import("@/app/api/v1/channels/official/route");
    await POST(req({ ...CORPO_BASE, phone_number_id: NUM_A }));

    // Nada foi inserido: o caminho tomado foi o de atualização.
    expect(db.escritas.map((e) => e.tipo)).toEqual([]);
    expect(db.linhas).toHaveLength(1);
    expect(reactivateChannelSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelSessionId: `canal-${NUM_A}` }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("com dois números conectados, o POST acha o CERTO", async () => {
    // A busca precisa casar número E organização. Uma busca só por número
    // alcançaria a linha de outra instalação (o admin client bypassa a RLS);
    // uma busca só por organização voltaria ao defeito original — e, com duas
    // linhas, ela nem saberia qual das duas devolver.
    makeDb([oficial(NUM_A), oficial(NUM_B)]);
    const { POST } = await import("@/app/api/v1/channels/official/route");
    await POST(req({ ...CORPO_BASE, phone_number_id: NUM_B }));

    expect(reactivateChannelSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelSessionId: `canal-${NUM_B}`, organizationId: ORG }),
      expect.objectContaining({ meta_phone_number_id: NUM_B }),
      expect.anything(),
    );
  });
});

describe("o apelido, que é o que distingue dois números na tela", () => {
  it("o apelido do operador vence o nome verificado da Meta", async () => {
    // Dois números da mesma conta chegam com o MESMO `verifiedName`. Sem o
    // apelido, o seletor de números do inbox mostra duas linhas idênticas e a
    // pessoa escolhe por onde responder no escuro.
    const db = makeDb([]);
    const { POST } = await import("@/app/api/v1/channels/official/route");
    await POST(req({ ...CORPO_BASE, phone_number_id: NUM_C, display_name: "Suporte" }));

    expect(db.escritas[0]?.patch.display_name).toBe("Suporte");
  });

  it("sem apelido, herda o nome verificado — não inventa nome vazio", async () => {
    const db = makeDb([]);
    const { POST } = await import("@/app/api/v1/channels/official/route");
    await POST(req({ ...CORPO_BASE, phone_number_id: NUM_C }));

    expect(db.escritas[0]?.patch.display_name).toBe("Loja");
  });
});

describe("GET — a tela recebe uma lista, e cada item traz o SEU webhook", () => {
  it("devolve todos os números, cada um com a própria URL de callback", async () => {
    // A URL sai do `webhook_path_token` DA LINHA. Uma URL única para a
    // organização faria o operador colar o endereço do primeiro número no painel
    // do segundo — a Meta aceita, e as respostas entram no canal errado.
    makeDb([oficial(NUM_A), oficial(NUM_B)]);
    const { GET } = await import("@/app/api/v1/channels/official/route");
    const res = await GET(
      new NextRequest("http://localhost/api/v1/channels/official", {
        headers: { origin: "https://crm.exemplo" },
      }),
    );
    const body = (await res.json()) as { data: { channels: Array<Record<string, unknown>> } };

    expect(body.data.channels).toHaveLength(2);
    // A asserção é sobre o CAMINHO, não sobre o host: a base pública sai de
    // `NEXT_PUBLIC_APP_URL` quando ela está configurada, e o `.env.local` de
    // quem roda a suíte localmente a define. Fechar no host faria este caso
    // passar ou falhar conforme a máquina, que é o oposto do que ele mede.
    expect(
      body.data.channels.map((c) =>
        new URL((c.webhook as { callbackUrl: string }).callbackUrl).pathname,
      ),
    ).toEqual([
      `/api/v1/webhooks/meta/tok-${NUM_A}`,
      `/api/v1/webhooks/meta/tok-${NUM_B}`,
    ]);
  });

  it("nunca devolve o token — só que ele existe", async () => {
    makeDb([oficial(NUM_A), oficial(NUM_B, { meta_token_encrypted: null })]);
    const { GET } = await import("@/app/api/v1/channels/official/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/channels/official"));
    const body = (await res.json()) as { data: { channels: Array<Record<string, unknown>> } };

    expect(body.data.channels.map((c) => c.hasToken)).toEqual([true, false]);
    expect(JSON.stringify(body)).not.toContain("cifra-velha");
  });
});
