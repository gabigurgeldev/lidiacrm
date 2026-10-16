/**
 * Quando o RUNTIME assume a saída de um turno que tentou afirmar sem fonte.
 *
 * O gate de fundamentação veta e ensina; o modelo costuma se corrigir na segunda
 * tentativa. Quando não se corrige — insiste na afirmação, ou desiste sem fazer o
 * que a instrução mandava —, o cliente não pode ficar nem com a invenção nem com
 * o silêncio. Esta função decide o que o sistema faz no lugar dele. Pura: o
 * turno passa os fatos, ela devolve a ação.
 *
 * - `equipe`: houve veto e ninguém chamou a passagem ⇒ o runtime passa, com o
 *   motivo `fora_da_base`. Mesmo que o modelo tenha mandado depois um "não sei":
 *   na empresa que tem equipe, "não sei" sem passagem deixa a pergunta sem dono.
 * - `so_agente`: o runtime só fala se o modelo NÃO falou depois do veto (ou se
 *   insistiu até o teto). Se ele já disse que não sabe, falar de novo seria o
 *   robô repetindo a mesma coisa com outras palavras.
 */
import type { ModoSemFonte } from '@/lib/schemas/settings';

export type AcaoSemFonte = 'nada' | 'passar_para_equipe' | 'dizer_que_nao_sabe';

/** Vetos de fundamentação no MESMO turno antes de o runtime assumir. */
export const MAX_VETOS_DE_FONTE = 2;

export function decidirFallbackSemFonte(f: {
  modo: ModoSemFonte;
  vetosDeFonte: number;
  /** O modelo chamou `request_human_handoff` com sucesso neste turno. */
  passouNoTurno: boolean;
  /** Alguma mensagem saiu DEPOIS do primeiro veto de fundamentação. */
  falouDepoisDoVeto: boolean;
  /** STOP/opt-out: nada sai, e passar quem pediu para parar não é resposta. */
  clienteBloqueado: boolean;
}): AcaoSemFonte {
  if (f.clienteBloqueado || f.vetosDeFonte === 0 || f.passouNoTurno) return 'nada';
  if (f.modo === 'equipe') return 'passar_para_equipe';
  const insistiu = f.vetosDeFonte >= MAX_VETOS_DE_FONTE;
  return insistiu || !f.falouDepoisDoVeto ? 'dizer_que_nao_sabe' : 'nada';
}
