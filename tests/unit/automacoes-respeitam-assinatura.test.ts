import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CATRACA: todo motor que fala com cliente em nome da organização consulta a
 * assinatura antes de agir.
 *
 * O defeito que isto impede é o mais caro da feature: a tela bloqueia, e a IA
 * continua respondendo no WhatsApp de quem não pagou (ou o disparo continua
 * mandando para 400 pessoas). Cada entrada abaixo é um lugar onde automação
 * NASCE; a lista é fechada, e quem acrescentar um motor novo acrescenta aqui.
 *
 * O que NÃO está na lista, de propósito: a ingestão de mensagem recebida
 * (webhooks de canal). Ela continua gravando — perder a mensagem do cliente
 * do cliente seria punir quem não tem nada com a cobrança.
 */
const RAIZ = join(__dirname, "..", "..");

const ENTRADAS: Array<{ arquivo: string; exige: RegExp; porque: string }> = [
  {
    arquivo: "workers/agent-worker/main.ts",
    exige: /organizacaoPodeOperarPg\(pool, job\.organization_id\)/,
    porque: "todo turno do agente (resposta, follow-up, caso, operador) passa pelo runJob",
  },
  {
    arquivo: "app/api/v1/cron/bulk-send-worker/route.ts",
    exige: /podeOperar:\s*organizacaoPodeOperar/,
    porque: "disparo em massa",
  },
  {
    arquivo: "app/api/v1/cron/flow-engine-worker/route.ts",
    exige: /podeOperar:\s*organizacaoPodeOperar/,
    porque: "execuções de fluxo",
  },
  {
    arquivo: "app/api/v1/cron/followup-flow-worker/route.ts",
    exige: /podeOperar:\s*organizacaoPodeOperar/,
    porque: "follow-ups por fluxo",
  },
  {
    arquivo: "app/api/v1/cron/aniversarios/route.ts",
    exige: /podeOperar:\s*organizacaoPodeOperar/,
    porque: "mensagem de aniversário",
  },
  {
    arquivo: "lib/automation/engine.handler.ts",
    exige: /organizacaoPodeOperar\(row\.organization_id\)/,
    porque: "regras automáticas (enviar WhatsApp, webhook, mudar etapa)",
  },
  {
    arquivo: "workers/ai-response-worker.handler.ts",
    exige: /organizacaoPodeOperar\(row\.organization_id\)/,
    porque: "resposta de IA pelo event_log",
  },
  {
    arquivo: "lib/auth/require-role.ts",
    exige: /"payment_required"/,
    porque: "API: layout não roda em rota de API",
  },
  {
    arquivo: "app/app/layout.tsx",
    exige: /redirect\("\/assinatura"\)/,
    porque: "tela",
  },
];

describe("automações respeitam a assinatura", () => {
  it.each(ENTRADAS)("$arquivo consulta a assinatura ($porque)", ({ arquivo, exige }) => {
    const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
    expect(fonte, `${arquivo} deixou de consultar a assinatura`).toMatch(exige);
  });

  it("os motores injetáveis PULAM a org bloqueada (não só recebem a dependência)", () => {
    for (const arquivo of [
      "lib/bulk-send/motor.ts",
      "lib/flow-engine/engine.ts",
      "lib/followup/engine.ts",
      "lib/aniversario/motor.ts",
    ]) {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      expect(fonte, arquivo).toMatch(/deps\.podeOperar && !\(await deps\.podeOperar\(/);
    }
  });
});
