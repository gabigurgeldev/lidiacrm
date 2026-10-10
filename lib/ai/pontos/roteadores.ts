/**
 * Roteadores de modelo e busca no catálogo — a parte pura do seletor de modelo.
 *
 * Um ROTEADOR não é um modelo: é um endereço da OpenRouter que escolhe, a cada
 * chamada, qual modelo responde (`openrouter/auto`, `typesafe/jev-router`…).
 * Para um ponto que só decide — como "Escolher quem conduz a conversa" do
 * coordenador — é justamente o que quem configura procura, e no catálogo eles
 * ficavam perdidos entre ~500 modelos numa lista sem busca (2026-10-10: "não
 * vi em nenhum momento a opção de escolher o modelo de decisão do OpenRouter").
 */

export interface ModeloDoCatalogo {
  provider: string;
  model_id: string;
  display_name: string;
}

/** Endereço que escolhe o modelo sozinho. Só existe na OpenRouter. */
export function ehRoteador(m: Pick<ModeloDoCatalogo, "provider" | "model_id">): boolean {
  if (m.provider !== "openrouter") return false;
  const id = m.model_id.toLowerCase();
  // `openrouter/*` são os endereços da própria OpenRouter (auto, fusion,
  // pareto-code, free…); os de terceiros se declaram no nome (`jev-router`).
  return id.startsWith("openrouter/") || /(^|[-/_])router($|[-/_])/u.test(id);
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "");
}

/**
 * Filtra pelo texto (id ou nome, sem acento nem caixa) e separa roteadores do
 * resto, roteadores primeiro. Busca vazia devolve tudo. `manter` é o modelo já
 * escolhido: ele fica na lista mesmo fora da busca, senão o campo aparece vazio
 * e parece que a escolha se perdeu.
 */
export function separarModelos<T extends ModeloDoCatalogo>(
  modelos: readonly T[],
  busca: string,
  manter?: string,
): { roteadores: T[]; modelos: T[] } {
  const termos = normalizar(busca).split(/\s+/u).filter(Boolean);
  const casa = (m: T) => {
    const alvo = normalizar(`${m.model_id} ${m.display_name}`);
    return termos.every((t) => alvo.includes(t));
  };
  const filtrados = modelos.filter((m) => casa(m) || m.model_id === manter);
  return {
    roteadores: filtrados.filter((m) => ehRoteador(m)),
    modelos: filtrados.filter((m) => !ehRoteador(m)),
  };
}
