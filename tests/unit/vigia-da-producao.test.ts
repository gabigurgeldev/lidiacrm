import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ler = (rel: string): string => readFileSync(join(RAIZ, rel), "utf8");

/**
 * Incidente de 2026-10-13: reboot da VPS deixou o kong do Supabase parado por
 * 2 h 10 e o WAHA desistiu de 676 de 679 webhooks em ~58 s (retry constante,
 * 15 × 2 s). Estes testes seguram as duas defesas que nasceram dali.
 */
describe("reentrega do webhook do WAHA em produção", () => {
  const compose = ler("docker-compose.prod.yml");

  it("usa backoff exponencial, com default no compose (um .env antigo não quebra)", () => {
    expect(compose).toContain(
      "WHATSAPP_HOOK_RETRIES_POLICY: ${WAHA_HOOK_RETRIES_POLICY:-exponential}",
    );
    expect(compose).toContain(
      "WHATSAPP_HOOK_RETRIES_DELAY_SECONDS: ${WAHA_HOOK_RETRIES_DELAY_SECONDS:-5}",
    );
    expect(compose).toContain(
      "WHATSAPP_HOOK_RETRIES_ATTEMPTS: ${WAHA_HOOK_RETRIES_ATTEMPTS:-11}",
    );
  });

  it("cobre mais de 1 hora de queda (base × (2^(n+1) − 2))", () => {
    const base = Number(/WAHA_HOOK_RETRIES_DELAY_SECONDS:-(\d+)/.exec(compose)?.[1]);
    const tentativas = Number(/WAHA_HOOK_RETRIES_ATTEMPTS:-(\d+)/.exec(compose)?.[1]);
    const cobertura = base * (2 ** (tentativas + 1) - 2); // WAHA: espera da n-ésima = 2^n × base
    expect(cobertura).toBeGreaterThan(3600);
  });
});

describe("scripts/vps/lidiacrm-watchdog.sh", () => {
  const script = ler("scripts/vps/lidiacrm-watchdog.sh");

  it("é bash válido", () => {
    const r = spawnSync("bash", ["-n", "scripts/vps/lidiacrm-watchdog.sh"], { cwd: RAIZ });
    expect(r.status, r.stderr?.toString()).toBe(0);
  });

  it("não carrega destinatário nem domínio de ninguém (vive em /etc/lidiacrm-watchdog.env)", () => {
    expect(script).not.toMatch(/@gmail\.|@hotmail\.|gestaltcrm\.com\.br/);
    expect(script).toContain('ALERTA_PARA=""');
    expect(script).toContain('HEALTH_URL=""');
  });

  it("só cura falha de partida: parada deliberada (sem erro, exit ≠ 255) é pulada", () => {
    expect(script).toContain('[ -z "$err" ] && [ "$code" != 255 ]');
  });

  it("não passa a senha SMTP na linha de comando (aparece em `ps`)", () => {
    expect(script).toContain("-K -");
    expect(script).not.toMatch(/--user\s+"?\$/);
  });
});
