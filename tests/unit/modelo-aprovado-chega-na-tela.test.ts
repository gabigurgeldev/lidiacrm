/**
 * O MODELO APROVADO CHEGA À TELA E SAI PELO FIO — os dois defeitos medidos.
 *
 * Relatados pelo dono do produto com a conexão oficial na mão:
 *
 *   1. "escolho o número mas ele não mostra os templates"
 *   2. "coloco o nome do template e a língua e não envia"
 *
 * Os dois tinham causa nossa, e os dois falhavam em SILÊNCIO — com uma frase
 * que culpava a conta do operador ("nenhum modelo aprovado nesta conta") ou o
 * template ("não está no espelho"), quando o errado era o nosso recorte e a
 * nossa exigência.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recorteDoEspelho } from "@/lib/channels/meta/recorte-do-espelho";

describe("1. qual coluna recorta o espelho", () => {
  it("⭐ a WABA da conexão ESCOLHIDA, nunca o id da sessão", () => {
    // O defeito exato: `channel_session_id` é o nome que a pergunta sugere, e
    // `template-sync.ts` NUNCA grava essa coluna — ele chaveia por `waba_id` e
    // deixa a sessão nula. Recortar por sessão devolvia zero linhas para toda
    // organização do canal oficial, com o espelho cheio.
    expect(
      recorteDoEspelho({ canalId: "canal-1", wabaDoCanal: "waba-9", wabaDaSessao: "waba-1" }),
    ).toEqual({ coluna: "waba_id", valor: "waba-9" });
  });

  it("⭐ a conexão escolhida GANHA da conexão oficial mais antiga", () => {
    // É o ponto de uma organização com duas contas: sem isto a lista era sempre
    // a da conta que `metaSessionForOrg` acha, que é a mais antiga.
    const r = recorteDoEspelho({
      canalId: "canal-2",
      wabaDoCanal: "waba-da-segunda",
      wabaDaSessao: "waba-da-primeira",
    });
    expect(r?.valor).toBe("waba-da-segunda");
  });

  it("conexão sem WABA conhecida cai na sessão — é o espelho do canal intermediado", () => {
    // Aquelas linhas SEMPRE gravam `channel_session_id`; sem este ramo elas
    // cairiam na WABA de outro canal.
    expect(
      recorteDoEspelho({ canalId: "canal-3", wabaDoCanal: null, wabaDaSessao: "waba-1" }),
    ).toEqual({ coluna: "channel_session_id", valor: "canal-3" });
  });

  it("sem conexão escolhida, é o comportamento de antes do parâmetro existir", () => {
    expect(recorteDoEspelho({ canalId: null, wabaDoCanal: null, wabaDaSessao: "waba-1" })).toEqual({
      coluna: "waba_id",
      valor: "waba-1",
    });
    expect(recorteDoEspelho({ canalId: null, wabaDoCanal: null, wabaDaSessao: null })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const consultaDoEspelho = { data: null as unknown, error: null as unknown };
/** O que `resolveMetaCreds` devolve — o teste troca para exercitar a ausência. */
const credencial = {
  data: null as null | { phoneNumberId: string; token: string; graphVersion: string },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/meta/credentials", () => ({
  resolveMetaCreds: vi.fn(async () => credencial.data),
}));

/** Um cliente que devolve o que o teste puser em `consultaDoEspelho`. */
function dbFalso() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => consultaDoEspelho,
  };
  return { from: () => chain } as never;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  consultaDoEspelho.data = null;
  consultaDoEspelho.error = null;
  credencial.data = { phoneNumberId: "phone-da-sessao", token: "token-da-sessao", graphVersion: "v22.0" };
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: "wamid.XYZ" }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("2. a credencial é a DA CONEXÃO, e não a do ambiente", () => {
  it("⭐ o template sai pelo número e pelo token da CONEXÃO escolhida", async () => {
    // O defeito: esta função lia `META_PHONE_NUMBER_ID` e
    // `META_SYSTEM_USER_TOKEN` do ambiente, e quem conecta o canal oficial pela
    // tela do produto não tem essas variáveis — o número e o token ficam em
    // `channel_sessions`, cifrados. O POST ia para
    // `graph.facebook.com/v22.0//messages` com `Bearer` vazio.
    //
    // O sintoma enganava: TEXTO funcionava, porque `metaCloudAdapter.send`
    // sempre usou `resolveMetaCreds`. Só o caminho de template tinha ficado no
    // env — e nada na tela ligava uma coisa à outra.
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );
    await sendTemplateForSession(dbFalso(), {
      organizationId: "org-1",
      sessionRef: "phone-da-sessao",
      to: "5511999998888",
      name: "boas_vindas",
      language: "pt_BR",
      values: {},
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/phone-da-sessao/messages");
    // A URL com o número VAZIO é a assinatura exata do defeito antigo.
    expect(String(url)).not.toContain("//messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer token-da-sessao",
    );
  });

  it("⭐ sem credencial nenhuma, RECUSA com nome próprio — não posta numa URL torta", async () => {
    // O POST para uma URL sem número devolvia um erro da Meta que mandava o
    // operador procurar no template. O problema estava na conexão.
    credencial.data = null;
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );

    await expect(
      sendTemplateForSession(dbFalso(), {
        organizationId: "org-1",
        sessionRef: null,
        to: "5511999998888",
        name: "boas_vindas",
        language: "pt_BR",
        values: {},
      }),
    ).rejects.toThrow(/template_sem_credencial/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("3. o nome escrito à mão sai pelo fio", () => {
  it("⭐ definição NÃO espelhada é MANDADA — a plataforma é a autoridade", async () => {
    // O defeito: `bindingState` devolvia `missing` e a tradução era
    // `template_missing: … não está no espelho` — SEM chamar a Meta. O operador
    // escrevia o nome de um template aprovado e a mensagem não saía, com o erro
    // culpando o template. A regra certa já estava escrita em
    // `conferir-definicao.ts`, que deixa o não espelhado passar de propósito.
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );

    const id = await sendTemplateForSession(dbFalso(), {
      organizationId: "org-1",
      sessionRef: "phone-da-sessao",
      to: "5511999998888",
      name: "confirmacao_pedido",
      language: "pt_BR",
      values: { "1": "Ana" },
    });

    expect(id).toBe("wamid.XYZ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(corpo.template.name).toBe("confirmacao_pedido");
    expect(corpo.template.language).toEqual({ code: "pt_BR" });
    expect(corpo.template.components[0].parameters[0].text).toBe("Ana");
  });

  it("⭐ sem espelho e sem parâmetro, NÃO manda `components` vazio", async () => {
    // Array vazio é recusado pela Meta, e template de reengajamento sem variável
    // é o caso mais comum de todos.
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );
    await sendTemplateForSession(dbFalso(), {
      organizationId: "org-1",
      sessionRef: "phone-da-sessao",
      to: "5511999998888",
      name: "boas_vindas",
      language: "pt_BR",
      values: {},
    });

    const corpo = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(corpo.template.components).toBeUndefined();
  });

  it("⭐ a recusa da plataforma sobe com o CÓDIGO dela, que é o acionável", async () => {
    // `132001` = nome/idioma que não existem; `133010` = não aprovado. É isso
    // que diz ao operador o que fazer — "não está no espelho" não dizia nada.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 132001, message: "template name does not exist" } }),
    });
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );

    await expect(
      sendTemplateForSession(dbFalso(), {
        organizationId: "org-1",
        sessionRef: "phone-da-sessao",
        to: "5511999998888",
        name: "nao_existe",
        language: "pt_BR",
        values: {},
      }),
    ).rejects.toThrow(/132001/u);
  });

  it("nome ou idioma em branco continua barrado ANTES da rede", async () => {
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );
    await expect(
      sendTemplateForSession(dbFalso(), {
        organizationId: "org-1",
        sessionRef: "phone-da-sessao",
        to: "5511999998888",
        name: "",
        language: "pt_BR",
        values: {},
      }),
    ).rejects.toThrow(/template_incompleto/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("⭐ definição ESPELHADA e reprovada continua sendo barrada", async () => {
    // A permissividade é só para o que não se sabe. O que o espelho SABE que
    // está reprovado não pode sair: a plataforma cobra por tentativa e recusa.
    consultaDoEspelho.data = {
      name: "promo",
      language: "pt_BR",
      status: "REJECTED",
      contract_hash: "h1",
      components: [],
    };
    const { sendTemplateForSession } = await import(
      "@/lib/channels/meta/send-template-for-session"
    );

    await expect(
      sendTemplateForSession(dbFalso(), {
        organizationId: "org-1",
        sessionRef: "phone-da-sessao",
        to: "5511999998888",
        name: "promo",
        language: "pt_BR",
        values: {},
      }),
    ).rejects.toThrow(/template_not_approved/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
