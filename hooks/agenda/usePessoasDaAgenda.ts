"use client";

import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { TRILHAS_DA_AGENDA, trilhasDaEquipe, type TrilhaDaAgenda } from "@/lib/agenda/tipos";
import { apiClient } from "@/lib/api/client";

import type { Pessoa } from "@/components/agenda/tipos";

import { CHAVE_DOS_PROFISSIONAIS, type ProfissionalDaApi } from "./useProfissionais";

/**
 * As PROFISSIONAIS ativas, na forma de `Pessoa` — quem a agenda desenha.
 *
 * ⚠️ ERA `/api/v1/team`, e a migration 0245 mudou a pergunta. Antes, quem
 * atendia era sempre um membro com login; agora a recepcionista cadastra a
 * esteticista que não usa o sistema, e ela tem agenda, cor e coluna sem ter
 * conta. Ler a equipe deixaria essa pessoa fora da barra de filtro e da visão por
 * profissional — exatamente quem a feature existe para pôr na tela.
 *
 * A COR: a trilha escolhida (`calendar_professionals.trilha`) vence; sem ela,
 * `trilhasDaEquipe` sobre `user_id ?? id` — a mesma derivação de antes para quem
 * tem login (a pessoa não troca de cor nesta mudança) e uma estável para quem não
 * tem. As trilhas saem do conjunto de uma vez, nunca pessoa a pessoa: é o único
 * jeito de duas não caírem na mesma cor.
 *
 * Mesma chave de `useProfissionais`, com `select`: uma busca serve a barra da
 * agenda e a tela de configuração, e salvar lá repinta aqui sem segunda ida.
 */
export function pessoasDe(lista: ProfissionalDaApi[]): Pessoa[] {
  const ativas = lista.filter((p) => p.ativo);
  const derivadas = trilhasDaEquipe(ativas.map((p) => p.user_id ?? p.id));
  return ativas.map((p) => ({
    id: p.id,
    nome: p.nome,
    trilha: trilhaValida(p.trilha) ?? derivadas.get(p.user_id ?? p.id) ?? 1,
    userId: p.user_id,
  }));
}

function trilhaValida(n: number | null): TrilhaDaAgenda | null {
  return (TRILHAS_DA_AGENDA as readonly number[]).includes(n ?? -1) ? (n as TrilhaDaAgenda) : null;
}

export function usePessoasDaAgenda(inicial?: ProfissionalDaApi[]) {
  return useQuery({
    queryKey: CHAVE_DOS_PROFISSIONAIS,
    ...(inicial ? { initialData: inicial } : {}),
    queryFn: async (): Promise<ProfissionalDaApi[]> => {
      try {
        const r = await apiClient.get<{ data: ProfissionalDaApi[] }>("/api/v1/agenda/profissionais");
        return ((r as unknown as { data?: ProfissionalDaApi[] }).data ??
          (r as unknown as ProfissionalDaApi[])) ?? [];
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    select: pessoasDe,
  });
}
