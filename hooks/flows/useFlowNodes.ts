"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * A paleta vem do SERVIDOR, projetada do registry de nós.
 *
 * Nenhuma lista de blocos vive no frontend: uma cópia aqui divergiria na
 * primeira adição, e a divergência seria da pior espécie — um bloco desenhável
 * que o motor recusa na publicação.
 */
export interface NoDaPaleta {
  type: string;
  version: number;
  category: string;
  rotulo: string;
  descricao: string;
  eventos: string[] | null;
}

export interface CategoriaDaPaleta {
  id: string;
  rotulo: string;
}

export interface Paleta {
  categorias: CategoriaDaPaleta[];
  nos: NoDaPaleta[];
}

export function usePaletaDeNos() {
  return useQuery({
    queryKey: ["flow-nodes"],
    // O catálogo só muda quando a imagem muda. Sem refetch: pedir de novo a cada
    // foco da janela seria uma chamada por nada.
    staleTime: Infinity,
    queryFn: () => apiClient.get<{ data: Paleta }>("/api/v1/flows/nodes").then((r) => r.data),
  });
}
