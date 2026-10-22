import { createHash } from "node:crypto";

/**
 * O nome curto pelo qual o AGENTE pede uma foto do acervo: `foto-` + 8 hex.
 *
 * Por que não o id do material: `projetarRetornoDeTool`
 * (`lib/agent-engine/agent/projecao.ts`) corta toda chave `*_id`/`*_path` antes
 * de o modelo ver o retorno do `search_knowledge` — UUID cru no contexto é fonte
 * medida de vazamento para o cliente. O apelido é derivado do id (estável entre
 * turnos, sem estado), o indexador o grava no trecho, e quem envia o recalcula
 * sobre as fotos do agente para achar o material.
 *
 * 8 hex = 32 bits: colisão entre as fotos de UM agente é desprezível, e se
 * acontecer o resolvedor recusa por ambiguidade em vez de escolher uma.
 */
export function apelidoDaFoto(sourceId: string): string {
  return `foto-${createHash("sha256").update(sourceId).digest("hex").slice(0, 8)}`;
}
