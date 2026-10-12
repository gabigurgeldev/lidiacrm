/**
 * O "refinar" do construtor, nas partes que não dependem de modelo nem de
 * banco: como a prévia é mostrada ao modelo e como a resposta dele é mesclada
 * na prévia sem desfazer o que a pessoa decidiu. A rota é
 * `app/api/v1/ai/agents/construtor/refinar/route.ts`.
 */
import type { z } from "zod";

import { normalizarGeracao, TETO_DE_MATERIAIS, type PreviaGerada, type saidaDoRefinoSchema } from "./esquemas";

/** Do conteúdo de cada material, o modelo vê só o começo: o pedido raramente é sobre o texto inteiro. */
export const AMOSTRA_DO_MATERIAL = 1_500;

export const INSTRUCOES_DO_REFINO = `
AJUSTE PEDIDO PELO DONO

Você recebe o agente que já foi escrito (a PRÉVIA ATUAL) e um PEDIDO do dono. Aplique o pedido e devolva o agente INTEIRO, já ajustado, seguindo as mesmas regras acima.
- Mude só o que o pedido pede. O que não foi pedido fica igual, palavra por palavra.
- Se o pedido traz um fato novo (preço, horário, política), ele passa a ser um fato que o dono informou: pode ir para o prompt ou para um material.
- Se o pedido contradiz uma regra de segurança acima (inventar preço, fingir ser humano, dar diagnóstico), não aplique essa parte e diga isso na explicação.
- Em "materiais_novos" vão só materiais a criar ou a substituir (mesmo nome substitui). Em "materiais_remover", só nomes que o dono mandou tirar.
- Em "explicacao", diga ao dono, em 1 a 3 frases, o que mudou.
`.trim();

export function descreverPrevia(p: PreviaGerada): string {
  return [
    `Nome: ${p.nome}`,
    `Descrição: ${p.descricao ?? ""}`,
    `Capacidades: ${p.pacotes.join(", ") || "(nenhuma)"}`,
    `Frases que chamam uma pessoa: ${p.handoff_keywords.join(", ") || "(nenhuma)"}`,
    `Coordenação — quando usar: ${p.coordenacao?.quando_usar ?? ""}`,
    "Prompt:",
    "<<<",
    p.system_prompt,
    ">>>",
    "Materiais (só o começo de cada um):",
    ...p.materiais.map((m) =>
      m.tipo === "faq"
        ? `- [FAQ] ${m.nome}: ${(m.itens ?? []).map((i) => i.pergunta).join(" | ").slice(0, AMOSTRA_DO_MATERIAL)}`
        : `- [Documento] ${m.nome}: ${(m.texto ?? "").slice(0, AMOSTRA_DO_MATERIAL)}`,
    ),
  ].join("\n");
}

/** A prévia nova: agente refeito, materiais mesclados, o resto preservado. Pura. */
export function mesclarRefino(
  atual: PreviaGerada,
  saida: z.infer<typeof saidaDoRefinoSchema>,
): PreviaGerada {
  const refeita = normalizarGeracao(saida.agente, { materiais: saida.materiais_novos });
  const remover = new Set(saida.materiais_remover.map((n) => n.trim().toLowerCase()));
  const substituidos = new Set(refeita.materiais.map((m) => m.nome.toLowerCase()));
  const mantidos = atual.materiais.filter(
    (m) => !remover.has(m.nome.toLowerCase()) && !substituidos.has(m.nome.toLowerCase()),
  );
  return {
    ...refeita,
    materiais: [...mantidos, ...refeita.materiais].slice(0, TETO_DE_MATERIAIS),
    // O que a pessoa decidiu na revisão não é do modelo para desfazer.
    coordenacao: atual.coordenacao
      ? { ...refeita.coordenacao!, incluir: atual.coordenacao.incluir, fluxos_chamaveis: atual.coordenacao.fluxos_chamaveis }
      : refeita.coordenacao,
    ...(atual.fontes_existentes ? { fontes_existentes: atual.fontes_existentes } : {}),
  };
}
