/**
 * Só credencial recusada é "senha incorreta". Os erros aqui têm o FORMATO que o
 * `@supabase/auth-js` produz — `name` é o que distingue as classes, e é por ele
 * que a regra compara (ver o cabeçalho de `erro-do-gotrue.ts`).
 */
import { describe, expect, it } from "vitest";

import { classificarErroDeLogin, classificarErroDeMfa, ehFalhaDeServico } from "./erro-do-gotrue";

const CREDENCIAL = { name: "AuthApiError", status: 400, code: "invalid_credentials" };
const GATEWAY_504 = { name: "AuthRetryableFetchError", status: 504 };
const REDE = { name: "AuthRetryableFetchError", status: 0 };
const ERRO_500 = { name: "AuthApiError", status: 500, code: "unexpected_failure" };

describe("classificarErroDeLogin", () => {
  it("credencial recusada é credencial", () => {
    expect(classificarErroDeLogin(CREDENCIAL)).toBe("credencial");
    // GoTrue antigo sem `code`: o 400 do password grant basta.
    expect(classificarErroDeLogin({ name: "AuthApiError", status: 400 })).toBe("credencial");
  });

  it("504, rede caída e 500 são instabilidade — nunca senha errada", () => {
    expect(classificarErroDeLogin(GATEWAY_504)).toBe("indisponivel");
    expect(classificarErroDeLogin(REDE)).toBe("indisponivel");
    expect(classificarErroDeLogin(ERRO_500)).toBe("indisponivel");
    expect(classificarErroDeLogin({ name: "AuthUnknownError" })).toBe("indisponivel");
  });

  it("um 400 que NÃO veio de AuthApiError não é credencial", () => {
    // O status sozinho não prova que o GoTrue respondeu.
    expect(classificarErroDeLogin({ name: "AuthRetryableFetchError", status: 400 })).toBe(
      "indisponivel",
    );
  });

  it("429 do GoTrue é limite, não senha errada", () => {
    expect(classificarErroDeLogin({ name: "AuthApiError", status: 429 })).toBe("limite");
  });

  it("sem erro nenhum (e sem usuário) é instabilidade", () => {
    expect(classificarErroDeLogin(null)).toBe("indisponivel");
  });
});

describe("classificarErroDeMfa", () => {
  it("código recusado (400/422) conta; o resto não", () => {
    expect(classificarErroDeMfa({ name: "AuthApiError", status: 422, code: "mfa_verification_failed" })).toBe(
      "codigo",
    );
    expect(classificarErroDeMfa({ name: "AuthApiError", status: 400 })).toBe("codigo");
    expect(classificarErroDeMfa(GATEWAY_504)).toBe("indisponivel");
    expect(classificarErroDeMfa(ERRO_500)).toBe("indisponivel");
  });
});

describe("ehFalhaDeServico", () => {
  it("sessão ausente e token recusado são RESPOSTAS, não falha de serviço", () => {
    expect(ehFalhaDeServico({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
    expect(ehFalhaDeServico({ name: "AuthApiError", status: 401 })).toBe(false);
    expect(ehFalhaDeServico(null)).toBe(false);
  });

  it("504, rede e 5xx são falha de serviço", () => {
    expect(ehFalhaDeServico(GATEWAY_504)).toBe(true);
    expect(ehFalhaDeServico(REDE)).toBe(true);
    expect(ehFalhaDeServico(ERRO_500)).toBe(true);
  });
});
