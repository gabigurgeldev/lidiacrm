/**
 * O envio Stevo sobrevive a um banco sem a coluna da migration 0210.
 *
 * ## O defeito que este arquivo impede de voltar
 *
 * `resolveEnvioStevo` decide TODO envio deste canal, e a coluna
 * `stevo_official_token_encrypted` nasceu na 0210. Um clone (ou a produção, no
 * intervalo entre a imagem subir e o schema ser aplicado) recebe `42703` no
 * `select` e — sem esta tolerância — perde junto o envio por **QR**, que
 * funcionava antes, não usa a coluna nova e não tem nada a ver com ela.
 *
 * Trocar o bug que se foi consertar por uma regressão maior é o pior desfecho
 * possível de uma migration, e foi medido de verdade: no dia em que a 0210 foi
 * empurrada, a coluna ainda não existia no banco de produção.
 *
 * Sem a coluna, o desfecho tem de ser EXATAMENTE o de antes dela existir: proxy.
 */
import { describe, expect, it } from "vitest";

import { resolveEnvioStevo } from "@/lib/channels/stevo/credentials";

const ERRO_DE_COLUNA = {
  code: "42703",
  message: 'column channel_sessions.stevo_official_token_encrypted does not exist',
};

/**
 * Um cliente de mentira que responde por CONSULTA, na ordem em que elas chegam.
 * O do PostgREST é thenable e encadeado, então cada `.eq()`/`.is()` devolve o
 * mesmo objeto e o `await` no fim é o que resolve.
 */
function admin(respostas: Array<{ data: unknown; error: unknown }>) {
  const colunasPedidas: string[] = [];
  let i = 0;
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "maybeSingle"]) {
    cadeia[m] = (arg?: unknown) => {
      if (m === "select") colunasPedidas.push(String(arg));
      return m === "maybeSingle" ? Promise.resolve(respostas[i++] ?? respostas.at(-1)) : cadeia;
    };
  }
  return {
    // `rpc` é a decifra real (`fn_decrypt_oauth`); devolver o texto direto evita
    // mockar o módulo de secrets, que já é exercitado no teste dele.
    cliente: { from: () => cadeia, rpc: async () => ({ data: "stevo_sk_x", error: null }) } as never,
    colunasPedidas,
    consultas: () => i,
  };
}

describe("resolveEnvioStevo — banco sem a coluna da 0210", () => {
  it("⭐ coluna ausente NÃO derruba o envio: cai no proxy, como antes da 0210", async () => {
    const a = admin([
      { data: null, error: ERRO_DE_COLUNA }, // com a coluna nova
      {
        data: { stevo_instance_id: "inst-1", stevo_token_encrypted: "\xAB" },
        error: null, // sem ela
      },
    ]);
    const envio = await resolveEnvioStevo(a.cliente, {
      organizationId: "org-1",
      instanceId: "inst-1",
    });

    expect(envio?.transporte).toBe("proxy");
    // A segunda tentativa tem de pedir MENOS colunas — senão ela repete o 42703.
    expect(a.colunasPedidas[0]).toContain("stevo_official_token_encrypted");
    expect(a.colunasPedidas.at(-1)).not.toContain("stevo_official_token_encrypted");
  });

  it("⭐ erro de verdade continua LANÇANDO — a tolerância não engole banco fora do ar", async () => {
    const a = admin([{ data: null, error: { code: "08006", message: "connection failure" } }]);

    await expect(
      resolveEnvioStevo(a.cliente, { organizationId: "org-1", instanceId: "inst-1" }),
    ).rejects.toThrow(/creds_lookup_failed/u);
  });

  it("⭐ 42703 de OUTRA coluna não é engolido — a detecção exige o nome", async () => {
    // `colunaAusenteNoErro` casa código E nome. Um 42703 de coluna alheia é
    // defeito nosso de consulta, e engoli-lo esconderia o defeito.
    const a = admin([
      { data: null, error: { code: "42703", message: "column x.inexistente does not exist" } },
      { data: null, error: { code: "42703", message: "column x.inexistente does not exist" } },
    ]);

    await expect(
      resolveEnvioStevo(a.cliente, { organizationId: "org-1", instanceId: "inst-1" }),
    ).rejects.toThrow(/creds_lookup_failed/u);
  });
});
