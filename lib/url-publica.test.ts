/**
 * O ENDEREÇO PÚBLICO DA INSTALAÇÃO — a regra que decide se um link viaja.
 *
 * O caso que dá nome a este arquivo foi medido em produção: o link público de
 * pareamento saía como `https://placeholder.invalid/pair/<token>`. A tela
 * mostrava o link pronto, o botão "Copiar" copiava, e o cliente do outro lado
 * abria um endereço morto. Nenhum erro, em lugar nenhum.
 *
 * A causa é `NEXT_PUBLIC_*` ser substituída no BUILD: a imagem genérica do
 * self-host é construída com o placeholder, então `process.env` sempre traz um
 * valor — e um `if (valor) return valor` nunca chega ao fallback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { baseConfiguradaUsavel, basePublica } from "./url-publica";

/** Uma requisição do jeito que `basePublica` a enxerga. */
function req(opts: { origin?: string | null; protocol?: string; host?: string }) {
  const headers = new Headers();
  if (opts.origin) headers.set("origin", opts.origin);
  return {
    headers,
    nextUrl: { protocol: opts.protocol ?? "https:", host: opts.host ?? "crm.cliente.com.br" },
  };
}

/** Troca o que `env.NEXT_PUBLIC_APP_URL` devolve, sem tocar no `process.env`. */
async function comBaseConfigurada(valor: string): Promise<typeof basePublica> {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: valor } }));
  const mod = (await import("./url-publica")) as typeof import("./url-publica");
  return mod.basePublica;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/env");
});

describe("baseConfiguradaUsavel", () => {
  it("⭐ recusa o placeholder do build — o defeito medido em produção", () => {
    expect(baseConfiguradaUsavel("https://placeholder.invalid")).toBeNull();
  });

  it("recusa o placeholder mesmo com caminho ou porta grudados", () => {
    // O `ARG` do Dockerfile é substituído literalmente; nada garante que ele
    // chegue aqui sozinho na string.
    expect(baseConfiguradaUsavel("https://placeholder.invalid:3000")).toBeNull();
    expect(baseConfiguradaUsavel("https://placeholder.invalid/app")).toBeNull();
  });

  it("recusa vazio e ausente", () => {
    expect(baseConfiguradaUsavel("")).toBeNull();
    expect(baseConfiguradaUsavel(undefined)).toBeNull();
  });

  it("⭐ aceita um domínio de verdade, e tira a barra do fim", () => {
    // A barra importa: o chamador concatena `${base}/pair/...`, e `//pair` é um
    // caminho diferente de `/pair` para o roteador.
    expect(baseConfiguradaUsavel("https://crm.cliente.com.br/")).toBe("https://crm.cliente.com.br");
    expect(baseConfiguradaUsavel("https://crm.cliente.com.br///")).toBe(
      "https://crm.cliente.com.br",
    );
  });
});

describe("basePublica", () => {
  it("⭐ com o placeholder do build, usa o host por onde a requisição chegou", async () => {
    // É o conserto inteiro, em uma linha: a instalação self-host serve por um
    // domínio que o build não conhecia, e a requisição é quem sabe qual é.
    const base = await comBaseConfigurada("https://placeholder.invalid");
    expect(base(req({ host: "crm.cliente.com.br" }))).toBe("https://crm.cliente.com.br");
  });

  it("⭐ o header `origin` vence o host, quando existe", async () => {
    const base = await comBaseConfigurada("https://placeholder.invalid");
    expect(base(req({ origin: "https://app.cliente.com.br", host: "interno:3000" }))).toBe(
      "https://app.cliente.com.br",
    );
  });

  it("⭐ base configurada de verdade vence a requisição", async () => {
    // Quem configurou o domínio quer aquele domínio, mesmo que a requisição
    // chegue por um proxy interno com outro nome.
    const base = await comBaseConfigurada("https://crm.cliente.com.br");
    expect(base(req({ host: "10.0.0.7:3000", protocol: "http:" }))).toBe(
      "https://crm.cliente.com.br",
    );
  });

  it("⭐ localhost configurado PERDE para um host real — o segundo valor inútil", async () => {
    // `env.NEXT_PUBLIC_APP_URL` tem `.default("http://localhost:3000")`. Numa
    // VPS que não define a variável, o filtro do placeholder deixava passar
    // localhost — igualmente morto no celular do cliente, e mais difícil de
    // perceber porque parece uma URL legítima.
    const base = await comBaseConfigurada("http://localhost:3000");
    expect(base(req({ host: "crm.cliente.com.br" }))).toBe("https://crm.cliente.com.br");
  });

  it("⭐ mas em desenvolvimento localhost CONTINUA valendo (contra-prova)", async () => {
    // Descartar localhost sempre consertaria a VPS quebrando a máquina de quem
    // desenvolve — onde a requisição também chega por localhost.
    const base = await comBaseConfigurada("http://localhost:3000");
    expect(base(req({ host: "localhost:3000", protocol: "http:" }))).toBe("http://localhost:3000");
  });

  it("127.0.0.1 conta como local, igual a localhost", async () => {
    const base = await comBaseConfigurada("http://127.0.0.1:3000");
    expect(base(req({ host: "crm.cliente.com.br" }))).toBe("https://crm.cliente.com.br");
  });

  it("nunca devolve barra no fim, venha de onde vier", async () => {
    const base = await comBaseConfigurada("https://placeholder.invalid");
    expect(base(req({ origin: "https://crm.cliente.com.br/" }))).toBe("https://crm.cliente.com.br");
  });

  it("⭐ o link montado é abrível — a asserção que o usuário viu falhar", async () => {
    const base = await comBaseConfigurada("https://placeholder.invalid");
    const url = `${base(req({ host: "crm.cliente.com.br" }))}/pair/6558f48cd4be6642c23b086e0be759d22af9bed1c1590fe1`;

    expect(url).toBe(
      "https://crm.cliente.com.br/pair/6558f48cd4be6642c23b086e0be759d22af9bed1c1590fe1",
    );
    expect(url, "o link não pode carregar o placeholder do build").not.toContain(
      "placeholder.invalid",
    );
    // E precisa ser uma URL que o browser aceita abrir.
    expect(() => new URL(url)).not.toThrow();
  });
});
