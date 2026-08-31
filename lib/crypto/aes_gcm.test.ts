/**
 * A chave da instalação é lida em BASE64 ou em HEX — e o hex é o caso que
 * custou caro.
 *
 * O defeito: `AI_CRED_AES_KEY` gerada com `openssl rand -hex 32` (64 caracteres
 * hex) atravessava `Buffer.from(raw, "base64")` sem erro nenhum, porque todo
 * caractere hex TAMBÉM é um caractere base64 válido. O resultado eram 48 bytes,
 * `createCipheriv` recusava, e a instalação inteira ficava sem cadastrar chave
 * de IA — com "Erro interno" na tela, nada no log do app (a falha acontece
 * antes do INSERT) e nada no log do Postgres.
 *
 * O primeiro teste é o de regressão: ele é escrito com a aritmética explícita
 * (64 chars base64 = 48 bytes) para que, se alguém reordenar `interpretarChave`
 * e o hex voltar a ser lido como base64, a falha diga POR QUE quebrou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE_HEX = "61fb339da2d4c96519bd0116326108e60148e64bcbd4211f1c420f64fffaf18e";
const CHAVE_B64 = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU="; // 32 bytes exatos

/**
 * O módulo memoiza a chave em `cachedKey`, então cada caso precisa de uma
 * instância nova — senão o primeiro `AI_CRED_AES_KEY` do arquivo venceria todos
 * os outros e os testes seguintes mediriam a chave errada, passando por engano.
 */
async function carregarCom(chave: string | undefined) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ env: { AI_CRED_AES_KEY: chave } }));
  return import("./aes_gcm");
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/env");
});

describe("AI_CRED_AES_KEY", () => {
  it("aceita hex de 64 caracteres — o formato que quebrava a instalação", async () => {
    // A prova de que o caminho antigo estava errado, no próprio teste: lida
    // como base64, esta string dá 48 bytes, e o AES-256 exige 32.
    expect(Buffer.from(CHAVE_HEX, "base64").length).toBe(48);
    expect(Buffer.from(CHAVE_HEX, "hex").length).toBe(32);

    const { encryptKey, decryptKey } = await carregarCom(CHAVE_HEX);
    const guardado = encryptKey("sk-or-v1-exemplo-de-chave");
    expect(decryptKey(guardado)).toBe("sk-or-v1-exemplo-de-chave");
  });

  it("aceita base64 de 32 bytes — o formato que o install.sh gera", async () => {
    expect(Buffer.from(CHAVE_B64, "base64").length).toBe(32);

    const { encryptKey, decryptKey } = await carregarCom(CHAVE_B64);
    const guardado = encryptKey("sk-ant-exemplo");
    expect(decryptKey(guardado)).toBe("sk-ant-exemplo");
  });

  it("recusa chave de tamanho errado com erro TIPADO e instrução de conserto", async () => {
    const { encryptKey, ChaveDeCifragemInvalida } = await carregarCom("curta-demais");

    expect(() => encryptKey("x")).toThrow(ChaveDeCifragemInvalida);
    try {
      encryptKey("x");
    } catch (err) {
      // O tipo é o que permite a rota responder 503 com instrução em vez de
      // "Erro interno. Tente de novo" — que é conselho falso aqui, porque
      // repetir nunca conserta variável de ambiente.
      expect(err).toBeInstanceOf(ChaveDeCifragemInvalida);
      expect((err as InstanceType<typeof ChaveDeCifragemInvalida>).comoCorrigir).toMatch(/openssl rand/);
    }
  });

  it("chaveDeCifragemUtilizavel() responde sem cifrar nada e sem devolver a chave", async () => {
    const boa = await carregarCom(CHAVE_HEX);
    expect(boa.chaveDeCifragemUtilizavel()).toEqual({ ok: true });

    const ruim = await carregarCom("nao-serve");
    const r = ruim.chaveDeCifragemUtilizavel();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("AI_CRED_AES_KEY");
      // A chave jamais aparece no diagnóstico — este endpoint é público.
      expect(r.erro).not.toContain("nao-serve");
    }
  });

  it("ausente é recusada dizendo o que fazer, não com stack de createCipheriv", async () => {
    const { chaveDeCifragemUtilizavel } = await carregarCom(undefined);
    const r = chaveDeCifragemUtilizavel();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.comoCorrigir).toMatch(/openssl rand/);
  });
});
