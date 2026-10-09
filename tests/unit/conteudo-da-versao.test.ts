/**
 * TODO CAMINHO QUE GRAVA VERSÃO DE AGENTE GRAVA O MESMO CONTEÚDO.
 *
 * Salvar rascunho, criar agente, reverter versão e aplicar proposta gravavam
 * `ai_agent_versions` cada um com a SUA lista de colunas, e cada lista esqueceu
 * alguma coisa: criar e reverter descartavam `followup` (reverter desligava os
 * follow-ups em silêncio), e aplicar proposta publicava a versão "melhorada" sem
 * acervo, sem escopo de funil, sem Operador, sem casos, sem áudio.
 *
 * O teste de deriva de `VERSION_COLUMNS` (`agent-version-columns-drift`) cobria
 * só os SELECTs — o buraco era nos INSERTs. Este cobre a lista única e cobra que
 * os quatro caminhos passem por ela.
 *
 * Sabotagem medida: tirar `followup` de `conteudoDaVersao` reprova o 1º e o 3º
 * casos; voltar o INSERT à mão no revert reprova o último.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLUNAS_DO_CONTEUDO, conteudoDaVersao } from "@/lib/ai/agents/conteudo-da-versao";
import { versionCreateSchema } from "@/lib/ai/agents/validation";

const MINIMA = versionCreateSchema.parse({
  system_prompt: "Você é a Ana, da recepção.",
  provider: "anthropic",
  model: "claude-sonnet-5",
  credential_id: null,
  channel_session_id: "22222222-2222-4222-8222-222222222222",
  followup: { enabled: true, flow_pointer_ids: ["33333333-3333-4333-8333-333333333333"] },
});

describe("conteudoDaVersao", () => {
  it("tem destino para TODO campo que a tela manda (versionCreateSchema)", () => {
    const doSchema = Object.keys(versionCreateSchema.shape).sort();
    const gravados = Object.keys(conteudoDaVersao(MINIMA)).sort();
    expect(gravados).toEqual(doSchema);
  });

  it("COLUNAS_DO_CONTEUDO é a mesma lista — quem copia versão lê exatamente o que grava", () => {
    expect([...COLUNAS_DO_CONTEUDO].sort()).toEqual(Object.keys(conteudoDaVersao(MINIMA)).sort());
  });

  it("leva o follow-up junto (era o que criar e reverter descartavam)", () => {
    expect(conteudoDaVersao(MINIMA).followup).toEqual({
      enabled: true,
      flow_pointer_ids: ["33333333-3333-4333-8333-333333333333"],
    });
  });
});

describe("os quatro caminhos que gravam versão passam pela lista única", () => {
  const ROOT = process.cwd();
  const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("salvar, criar e reverter (server actions do editor)", () => {
    const fonte = ler("app/app/ai/agents/[id]/_actions.ts");
    expect(fonte.match(/\.\.\.conteudoDaVersao\(/g)?.length).toBe(3);
    // Lista à mão de volta é o defeito voltando: a linha que mais aparece nela.
    expect(fonte).not.toMatch(/system_prompt: (v|src)\.system_prompt/);
  });

  it("aplicar proposta copia as colunas da lista única", () => {
    const fonte = ler("lib/ai/apply-proposal.ts");
    expect(fonte).toMatch(/\.\.\.conteudoDaVersao\(/);
    expect(fonte).toMatch(/\.\.\.COLUNAS_DO_CONTEUDO/);
  });
});
