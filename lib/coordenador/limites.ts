/**
 * Limites de transição — regra pura, sem I/O.
 *
 * Duas coisas que parecem iguais e não são:
 *
 *   - **Retorno esperado** (uma chamada com retorno devolve ao chamador): é o
 *     ciclo legítimo A → B → A. Não conta como transferência indevida — senão
 *     o próprio caso obrigatório (agente chama fluxo e retoma) bateria no limite.
 *   - **Pingue-pongue** (A → B → A → B sem chamada no meio): é o laço que o
 *     limite existe para conter, normalmente dois especialistas se devolvendo a
 *     mesma pergunta.
 *
 * Ao estourar, quem decide o que fazer é o chamador (fallback + aviso na
 * Central); esta função só diz SE e POR QUÊ.
 */
import type { CategoriaDeTransicao } from "./estado";
import type { Limites } from "./politica/schema";

export interface TransicaoRecente {
  para_tipo: string | null;
  para_id: string | null;
  categoria: CategoriaDeTransicao;
  status: string;
  created_at: string;
}

export type VeredictoDeLimite =
  | { ok: true }
  | { ok: false; motivo: "transferencias_demais" | "ciclo_detectado" | "profundidade_excedida" };

/** Transições que contam para o limite: aplicadas, que trocam executor, e não são retorno. */
function conta(t: TransicaoRecente): boolean {
  return (
    t.status === "aplicada" &&
    t.categoria !== "retorno" &&
    t.categoria !== "manual" &&
    (t.para_tipo === "agente" || t.para_tipo === "fluxo")
  );
}

export function avaliarLimites(args: {
  recentes: readonly TransicaoRecente[];
  limites: Limites;
  agora: Date;
  proposta: { para_tipo: "agente" | "fluxo"; para_id: string; categoria: CategoriaDeTransicao };
  profundidade?: number;
}): VeredictoDeLimite {
  const { recentes, limites, agora, proposta } = args;

  if (args.profundidade !== undefined && args.profundidade > limites.profundidade_max) {
    return { ok: false, motivo: "profundidade_excedida" };
  }
  // Retorno nunca é barrado por contagem: barrar a volta deixaria a origem
  // suspensa para sempre, que é pior do que o laço.
  if (proposta.categoria === "retorno") return { ok: true };

  const desde = agora.getTime() - limites.janela_minutos * 60_000;
  const naJanela = recentes
    .filter((t) => conta(t) && new Date(t.created_at).getTime() >= desde)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (naJanela.length + 1 > limites.transferencias_por_janela) {
    return { ok: false, motivo: "transferencias_demais" };
  }

  // Pingue-pongue: os últimos destinos alternam entre os mesmos dois, e a
  // proposta repete o padrão pela terceira vez (A,B,A,B → A).
  const sequencia = [...naJanela.map((t) => t.para_id), proposta.para_id].slice(-5);
  if (sequencia.length >= 5) {
    const [a, b] = [sequencia[0], sequencia[1]];
    const alterna = a !== b && sequencia.every((id, i) => id === (i % 2 === 0 ? a : b));
    if (alterna) return { ok: false, motivo: "ciclo_detectado" };
  }

  return { ok: true };
}

/** Quantas decisões por modelo cabem ainda nesta hora. */
export function decisorPodeChamar(args: {
  chamadasNaUltimaHora: number;
  limites: Limites;
}): boolean {
  return args.chamadasNaUltimaHora < args.limites.decisor_chamadas_por_hora;
}
