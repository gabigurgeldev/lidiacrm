import { describe, expect, it } from "vitest";

import { montarRequisicao, renderizarConfirmacao } from "./caminho";

const SESSAO = { contaId: "org-123", contaEmail: "dono@loja.com" };

function montar(
  caminho: string,
  valores: Record<string, string | number | boolean>,
  opts: { base?: string; metodo?: "GET" | "POST"; parametros?: unknown; sessao?: typeof SESSAO | null; corpo_fixo?: Record<string, unknown> } = {},
) {
  return montarRequisicao({
    baseUrl: opts.base ?? "https://api.sistema.com/suporte/v1",
    endpoint: {
      metodo: opts.metodo ?? "GET",
      caminho,
      parametros:
        opts.parametros ??
        Object.keys(valores).map((nome) => ({ nome, tipo: "string", obrigatorio: true, descricao: "", onde: "query" })),
      corpo_fixo: opts.corpo_fixo ?? null,
    },
    valores,
    sessao: opts.sessao === undefined ? SESSAO : opts.sessao,
    telefoneDoContato: "+5511999990000",
  });
}

describe("montarRequisicao — a conta vem da sessão, nunca do modelo", () => {
  it("injeta {{conta.id}} da sessão verificada", () => {
    const r = montar("/contas/{{conta.id}}/diagnostico", {});
    expect(r).toEqual({
      ok: true,
      requisicao: { url: "https://api.sistema.com/suporte/v1/contas/org-123/diagnostico", metodo: "GET", corpo: null },
    });
  });

  it("sem sessão, {{conta.id}} recusa com identidade_necessaria", () => {
    const r = montar("/contas/{{conta.id}}/diagnostico", {}, { sessao: null });
    expect(r).toMatchObject({ ok: false, erro: "identidade_necessaria" });
  });

  it.each([
    ["../../contas/outra/diagnostico"],
    ["..%2f..%2fcontas"],
    [".."],
    ["."],
    ["a/b"],
    ["a\\b"],
    ["x?conta=outra"],
    ["x#frag"],
  ])("valor de caminho com estrutura de URL é recusado: %s", (valor) => {
    const r = montar("/pedidos/{{params.pedido}}", { pedido: valor }, {
      parametros: [{ nome: "pedido", tipo: "string", obrigatorio: true, descricao: "", onde: "path" }],
    });
    expect(r).toMatchObject({ ok: false, erro: "parametro_invalido_no_caminho" });
  });

  it("valor comum vai codificado no caminho", () => {
    const r = montar("/pedidos/{{params.pedido}}", { pedido: "AB 12" }, {
      parametros: [{ nome: "pedido", tipo: "string", obrigatorio: true, descricao: "", onde: "path" }],
    });
    expect(r.ok && r.requisicao.url).toBe("https://api.sistema.com/suporte/v1/pedidos/AB%2012");
  });

  it("id devolvido pelo sistema externo com estrutura de URL também é recusado", () => {
    const r = montar("/contas/{{conta.id}}", {}, { sessao: { contaId: "../admin", contaEmail: "x@y.com" } });
    expect(r).toMatchObject({ ok: false, erro: "parametro_invalido_no_caminho" });
  });

  it("marcador desconhecido recusa", () => {
    expect(montar("/x/{{organizacao.id}}", {})).toMatchObject({ ok: false, erro: "marcador_desconhecido" });
  });

  it("parâmetros de query vão na query string, sem trocar a origem", () => {
    const r = montar("/busca", { termo: "camisa azul" });
    expect(r.ok && r.requisicao.url).toBe("https://api.sistema.com/suporte/v1/busca?termo=camisa+azul");
  });

  it("o corpo fixo vence o valor do modelo e recebe a conta da sessão", () => {
    const r = montar(
      "/acoes/x",
      { conta_alvo: "org-999" },
      {
        metodo: "POST",
        parametros: [{ nome: "conta_alvo", tipo: "string", obrigatorio: true, descricao: "", onde: "body" }],
        corpo_fixo: { conta_alvo: "{{conta.id}}" },
      },
    );
    expect(r.ok && JSON.parse(r.requisicao.corpo ?? "{}")).toEqual({ conta_alvo: "org-123" });
  });

  it("caminho que tenta sair da base pelo template é recusado", () => {
    const r = montar("/../../../admin", {});
    expect(r).toMatchObject({ ok: false, erro: "destino_fora_da_base" });
  });
});

describe("renderizarConfirmacao", () => {
  it("só troca params, nunca a conta", () => {
    expect(renderizarConfirmacao("Reconectar o canal {{params.canal}} da {{conta.id}}?", { canal: "2" })).toBe(
      "Reconectar o canal 2 da {{conta.id}}?",
    );
  });
});
