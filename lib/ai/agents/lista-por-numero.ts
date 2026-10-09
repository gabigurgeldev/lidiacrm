/**
 * A lista de agentes agrupada por NÚMERO — a pergunta que o dono faz é "quem
 * atende o meu WhatsApp X?", não "quais agentes existem".
 *
 * Antes, a lista era uma grade de cartões sem número nenhum: dois agentes no
 * mesmo número (que dividem o atendimento pelo filtro de assunto ou pela
 * prioridade) apareciam soltos, sem nada dizendo que competiam pela mesma
 * conversa, e o rascunho parecia tão "em uso" quanto o publicado.
 *
 * Regras:
 *  - o número de um agente é o da VERSÃO PUBLICADA (é o que o motor lê);
 *    rascunho e agente sem versão vão para "Sem número no ar";
 *  - dentro do número, a ordem é a do motor: prioridade maior primeiro, depois
 *    o mais antigo — quem aparece em cima é quem atende quando os dois aceitam;
 *  - números conectados que não têm agente também aparecem, vazios: "ninguém
 *    atende este número" é a informação mais importante da tela;
 *  - arquivados só com o filtro, num grupo próprio no fim.
 */

export interface AgenteDaLista {
  id: string;
  name: string;
  priority?: number | null;
  created_at?: string | null;
  versao_publicada?: { channel_session_id?: string | null } | null;
}

export interface NumeroDaLista {
  id: string;
  display_name: string;
  phone_number: string | null;
  status: string;
}

export type ChaveDoGrupo = { tipo: "numero"; numero: NumeroDaLista } | { tipo: "sem_numero" } | { tipo: "arquivados" };

export interface GrupoDaLista<A> {
  chave: ChaveDoGrupo;
  agentes: A[];
}

function ordemDoMotor<A extends AgenteDaLista>(a: A, b: A): number {
  const p = (b.priority ?? 0) - (a.priority ?? 0);
  if (p !== 0) return p;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

export function agruparPorNumero<A extends AgenteDaLista>(
  agentes: readonly A[],
  numeros: readonly NumeroDaLista[],
  opts: { arquivado: (a: A) => boolean; mostrarArquivados: boolean },
): GrupoDaLista<A>[] {
  const porNumero = new Map<string, A[]>();
  const semNumero: A[] = [];
  const arquivados: A[] = [];
  const conhecidos = new Set(numeros.map((n) => n.id));

  for (const a of agentes) {
    if (opts.arquivado(a)) {
      arquivados.push(a);
      continue;
    }
    const numero = a.versao_publicada?.channel_session_id ?? null;
    if (numero !== null && conhecidos.has(numero)) {
      porNumero.set(numero, [...(porNumero.get(numero) ?? []), a]);
    } else {
      semNumero.push(a);
    }
  }

  const grupos: GrupoDaLista<A>[] = [...numeros]
    .sort((x, y) => x.display_name.localeCompare(y.display_name, "pt-BR"))
    .map((numero) => ({ chave: { tipo: "numero" as const, numero }, agentes: (porNumero.get(numero.id) ?? []).sort(ordemDoMotor) }));

  if (semNumero.length > 0) {
    grupos.push({ chave: { tipo: "sem_numero" }, agentes: semNumero.sort(ordemDoMotor) });
  }
  if (opts.mostrarArquivados && arquivados.length > 0) {
    grupos.push({ chave: { tipo: "arquivados" }, agentes: arquivados.sort(ordemDoMotor) });
  }
  return grupos;
}
