/**
 * Código TOTP que ainda NÃO foi enviado — por ninguém, em nenhum worker.
 *
 * O GoTrue aceita cada código uma vez só (proteção contra replay). A suíte
 * loga o mesmo admin em dezenas de specs seguidas, e cada helper guardava o
 * "último código enviado" na memória do próprio módulo. Duas coisas apagavam
 * essa memória sem aviso:
 *
 *  - o Playwright REINICIA o worker depois de todo teste que falha — o módulo
 *    é recarregado e a lembrança some;
 *  - helpers diferentes (`helpers/login-admin.ts`, `rbac-roles`,
 *    `system-update`, `admin-gestao-usuarios`) tinham cada um a sua.
 *
 * Medido no CI em 2026-10-09: uma falha derrubava a seguinte — o teste novo
 * reenviava o código da mesma janela, era recusado como replay, travava no
 * desafio de MFA e morria no teto de 30 s, o que reiniciava o worker de novo.
 *
 * A lembrança agora mora em ARQUIVO (contador da janela por segredo), e a
 * espera pela janela seguinte devolve o tempo ao teste: ela é do protocolo,
 * não da tela.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { type Page, test } from "@playwright/test";

import { generateTotp, msUntilNextTotpWindow } from "./totp";

const ARQUIVO = path.join(process.cwd(), ".e2e-totp-usados.json");
const PERIODO_MS = 30_000;
/** Perto da virada, o código pode vencer no caminho até o servidor. */
const MARGEM_MS = 3_000;

function chave(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function lerUsados(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

function janelaAtual(): number {
  return Math.floor(Date.now() / PERIODO_MS);
}

async function esperar(page: Page, ms: number): Promise<void> {
  const info = test.info();
  info.setTimeout(info.timeout + ms);
  await page.waitForTimeout(ms);
}

/** Espera, se preciso, até existir um código inédito para `secret`; marca-o como usado e o devolve. */
export async function codigoInedito(page: Page, secret: string): Promise<string> {
  const k = chave(secret);
  for (;;) {
    const ultimaUsada = lerUsados()[k] ?? -1;
    if (janelaAtual() > ultimaUsada && msUntilNextTotpWindow() >= MARGEM_MS) break;
    await esperar(page, msUntilNextTotpWindow() + 300);
  }
  const usados = lerUsados();
  usados[k] = janelaAtual();
  fs.writeFileSync(ARQUIVO, JSON.stringify(usados));
  return generateTotp(secret);
}

/** Depois de um código recusado, a próxima tentativa só faz sentido na janela seguinte. */
export async function esperarProximaJanela(page: Page): Promise<void> {
  await esperar(page, msUntilNextTotpWindow() + 300);
}
