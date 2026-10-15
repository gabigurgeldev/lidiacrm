import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COLUNAS_DO_CONTEUDO } from "@/lib/ai/agents/conteudo-da-versao";

/**
 * TODA COLUNA DE CONTEÚDO DA VERSÃO É VIGIADA PELO TRIGGER DE IMUTABILIDADE.
 *
 * Versão publicada de agente não se edita: muda-se criando rascunho novo e
 * publicando. Quem garante isso no banco é `fn_ai_agent_version_content_immutable`,
 * que compara coluna a coluna — e cada migration que acrescenta coluna de
 * conteúdo reescreve a função inteira para incluí-la (0222, 0223, 0226, 0227,
 * 0236, 0241…). Esquecer uma vez deixa aquela coluna mutável numa versão
 * publicada: o comportamento do agente muda sem versão nova e sem rastro.
 *
 * Nada cobrava isso. `COLUNAS_DO_CONTEUDO` é a lista do que a tela grava; aqui
 * se confere que a ÚLTIMA definição da função no `baseline.sql` (a que vale
 * depois de o apêndice rodar inteiro) cita cada uma delas.
 */
const BASELINE = path.join(process.cwd(), "supabase/baseline.sql");

function ultimaDefinicao(): string {
  const sql = readFileSync(BASELINE, "utf8");
  const marco = "create or replace function fn_ai_agent_version_content_immutable()";
  const ini = sql.lastIndexOf(marco);
  expect(ini, "não achei a função no baseline").toBeGreaterThan(-1);
  const fim = sql.indexOf("$fn$;", ini);
  expect(fim, "não achei o fim da função").toBeGreaterThan(ini);
  return sql.slice(ini, fim);
}

describe("trigger de imutabilidade da versão do agente", () => {
  it("cita toda coluna de conteúdo que a tela grava", () => {
    const corpo = ultimaDefinicao();
    // Controle: o instrumento enxerga uma coluna que sempre esteve lá.
    expect(corpo).toContain("new.system_prompt");
    const faltando = COLUNAS_DO_CONTEUDO.filter((c) => !new RegExp(`new\\.${c}\\s+is distinct from old\\.${c}\\b`).test(corpo));
    expect(
      faltando,
      "coluna de conteúdo fora do trigger: numa versão PUBLICADA ela muda sem versão nova. " +
        "Reescreva `fn_ai_agent_version_content_immutable` numa migration nova (e no apêndice do baseline) incluindo-a.",
    ).toEqual([]);
  });
});
