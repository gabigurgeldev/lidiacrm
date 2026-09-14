/**
 * "Tem o marcador X?" — a pergunta pronta do bloco "Decidir".
 *
 * ## Por que não é operador novo
 *
 * Nada aqui muda `condicoes.ts` nem o schema do grafo: a pergunta é MONTADA
 * com o que o avaliador já entende, e `lerMarcador` reconhece a forma de volta
 * para a tela poder desenhá-la como uma pergunta em vez de duas regras cruas.
 * Um operador novo obrigaria toda versão publicada a conhecer um vocabulário
 * que ela não tem — e um grafo velho lido por um motor novo é exatamente onde
 * isso quebra em silêncio.
 *
 * ## Por que OS DOIS campos
 *
 * O marcador mora no lead OU no contato — ver `nodes/marcadores.ts`. Perguntar
 * só por `lead.tags` daria "não" para todo cliente que chegou pelo WhatsApp,
 * porque esse fluxo não tem lead nenhum.
 *
 * ## Por que "não tem" é NEGAR O GRUPO, e nunca `not_contains`
 *
 * Pela regra de ausência de `condicoes.ts`, campo ausente é FALSO para todo
 * operador — `not_contains` incluído. Então, num fluxo sem lead,
 * `lead.tags not_contains vip` devolveria falso: a pergunta "não tem vip?"
 * responderia "não" justamente para quem não tem. `negar` inverte o grupo
 * inteiro depois de avaliado, que é a pergunta certa.
 */

import type { Grupo, Regra } from "./condicoes";

/** Os dois lugares onde um marcador pode estar. */
export const CAMPOS_DE_MARCADOR = ["lead.tags", "contact.tags"] as const;

export interface PerguntaDeMarcador {
  tag: string;
  /** `true` = "tem o marcador"; `false` = "não tem". */
  tem: boolean;
}

export function montarMarcador({ tag, tem }: PerguntaDeMarcador): Grupo {
  const grupo: Grupo = {
    combinador: "or",
    itens: CAMPOS_DE_MARCADOR.map((campo) => ({ campo, op: "contains" as const, valor: tag })),
  };
  return tem ? grupo : { ...grupo, negar: true };
}

function ehGrupo(item: Regra | Grupo): item is Grupo {
  return typeof item === "object" && item !== null && "itens" in item;
}

/**
 * A volta: reconhece a forma exata que `montarMarcador` produz, e só ela.
 *
 * Deliberadamente estrito — um grupo parecido, editado à mão ou vindo da IA,
 * devolve `null` e a tela cai no editor de campo cru. Reconhecer "quase" faria
 * a tela redesenhar como pergunta simples algo que na verdade pergunta outra
 * coisa, e a pessoa salvaria por cima sem saber o que perdeu.
 */
export function lerMarcador(item: Regra | Grupo): PerguntaDeMarcador | null {
  if (!ehGrupo(item)) return null;
  if (item.combinador !== "or") return null;
  if (item.itens.length !== CAMPOS_DE_MARCADOR.length) return null;

  const tags = new Set<string>();
  for (const [i, regra] of item.itens.entries()) {
    if (regra === undefined || ehGrupo(regra)) return null;
    if (regra.campo !== CAMPOS_DE_MARCADOR[i]) return null;
    if (regra.op !== "contains") return null;
    // Texto vazio CONTA como a forma: é o estado de quem acabou de trocar para
    // "tem o marcador" e ainda não digitou. Recusá-lo faria a tela voltar
    // sozinha para o editor de campo cru no primeiro clique.
    if (typeof regra.valor !== "string") return null;
    tags.add(regra.valor);
  }

  const [tag] = [...tags];
  if (tags.size !== 1 || tag === undefined) return null;

  return { tag, tem: item.negar !== true };
}
