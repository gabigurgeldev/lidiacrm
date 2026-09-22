"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { BUSCA_MIN, type SearchResult } from "@/lib/schemas/search";

/**
 * O termo, atrasado — a peça que separa "digitar" de "perguntar ao servidor".
 *
 * 250ms é o intervalo entre teclas de quem digita normalmente: mais curto e
 * cada letra vira uma requisição; mais longo e a lista parece travada. Sem
 * isto, "joão" seriam quatro buscas e as três primeiras seriam jogadas fora —
 * e num banco de verdade a terceira ainda estaria rodando quando a quarta
 * chegasse.
 */
export function useTermoAtrasado(termo: string, ms = 250): string {
  const [atrasado, setAtrasado] = useState(termo);
  useEffect(() => {
    const id = setTimeout(() => setAtrasado(termo), ms);
    return () => clearTimeout(id);
  }, [termo, ms]);
  return atrasado;
}

export interface BuscaGlobalData {
  results: SearchResult[];
  /** `true` quando uma das fontes falhou e a lista veio incompleta. */
  parciais: boolean;
}

/**
 * Contatos, conversas e leads para a paleta do ⌘K.
 *
 * `enabled` com o mesmo piso do schema (`BUSCA_MIN`): abaixo dele o servidor
 * recusaria com 422, e pedir para receber um erro previsível é desperdício dos
 * dois lados. Ler a constante em vez de repetir `2` mantém as duas pontas
 * amarradas — um dia em que o piso mude, muda aqui junto.
 *
 * Sem `refetchInterval`: busca é pergunta pontual, não estado que envelhece.
 * `staleTime` de 30s porque apagar uma letra e redigitá-la é o gesto mais comum
 * dentro da paleta, e ele não merece uma segunda ida ao banco.
 */
export function useBuscaGlobal(termo: string) {
  const alvo = termo.trim();
  const habilitada = alvo.length >= BUSCA_MIN;

  return useQuery({
    queryKey: ["busca-global", alvo],
    enabled: habilitada,
    staleTime: 30_000,
    queryFn: () =>
      apiClient
        .get<{ data: BuscaGlobalData }>(`/api/v1/search?q=${encodeURIComponent(alvo)}`)
        .then((r) => r.data),
  });
}
