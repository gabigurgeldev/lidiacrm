/**
 * PROFISSIONAIS NA TELA — as traduções puras entre o que a API diz sobre quem
 * atende e o que a grade e o painel desenham.
 *
 * Puro de propósito (sem React, sem relógio, sem rede): é a parte desta feature
 * que mais fácil erra em silêncio — um id de membro onde se esperava um de
 * profissional pinta o bloco na cor errada sem quebrar nada —, e é a que se
 * prova com teste de unidade em vez de tela.
 */
import type { OrigemDoAgendamento } from "@/lib/agenda/tipos";

import type { Agendamento, HorarioLivre, Pessoa } from "./tipos";

/**
 * O selo de ORIGEM, curto — a pergunta "quem pôs isto aqui?" respondida em uma
 * palavra. A chave é o texto em português (passa por `t()` em quem desenha).
 *
 * `mcp` vira "IA" e não "MCP": o dono da clínica não sabe o que é MCP, sabe que
 * tem um atendente de IA. É o vocabulário do produto, não o do protocolo.
 */
export const SELO_DA_ORIGEM: Record<OrigemDoAgendamento, string> = {
  ui: "Tela",
  mcp: "IA",
  google_sync: "Google",
  public_page: "Página pública",
};

/**
 * Põe na coluna e na cor CERTAS o que ainda chega por `user_id`.
 *
 * Dois casos chegam com o MEMBRO no lugar da profissional: a ocupação do Google
 * (a tabela de eventos externos só sabe a conexão, e a conexão é de um membro) e
 * agendamento anterior à 0245 sem participante. Sem esta tradução, o bloco não
 * acha pessoa nenhuma (`pessoas.find(p => p.id === responsavelId)`), cai na
 * trilha 1 e some do filtro por pessoa — a ocupação do Google da Ana pintada na
 * cor de outra e invisível quando se isola a Ana.
 *
 * Id que já é de profissional passa intacto; id que não casa com ninguém também
 * (melhor um bloco sem cor que um bloco na pessoa errada).
 */
export function responsavelDaGrade(agendamentos: Agendamento[], pessoas: Pessoa[]): Agendamento[] {
  const porMembro = new Map<string, string>();
  const ids = new Set<string>();
  for (const p of pessoas) {
    ids.add(p.id);
    if (p.userId) porMembro.set(p.userId, p.id);
  }
  const traduz = (id: string): string => (ids.has(id) ? id : (porMembro.get(id) ?? id));
  return agendamentos.map((a) => {
    const responsavelId = traduz(a.responsavelId);
    const apoioId = a.apoioId ? traduz(a.apoioId) : undefined;
    if (responsavelId === a.responsavelId && apoioId === a.apoioId) return a;
    return { ...a, responsavelId, ...(apoioId ? { apoioId } : {}) };
  });
}

/** "Ana" ou "Ana + Bia" — quem atende um horário, na ordem principal, apoio. */
export function rotuloDeQuem(
  opcao: { principalId: string; apoioId: string | null },
  nomes: ReadonlyMap<string, string>,
): string {
  const principal = nomes.get(opcao.principalId) ?? "";
  const apoio = opcao.apoioId ? (nomes.get(opcao.apoioId) ?? "") : "";
  return [principal, apoio].filter(Boolean).join(" + ");
}

/**
 * Os horários da rota, agrupados por dia e já dizendo QUEM atende cada um.
 *
 * A PRIMEIRA opção é a que o horário mostra, e é ela que vai no POST: o que a
 * pessoa vê no botão é o que ela marca. Deixar a rota escolher sozinha ("sem ids
 * escolhe a 1ª opção do instante") daria o mesmo resultado hoje e um diferente
 * no dia em que a ordem das opções mudasse entre a busca e o clique.
 *
 * `formatar` vem de quem chama porque a chave do dia e o rótulo da hora são do
 * fuso de APRESENTAÇÃO — este módulo não lê relógio nem fuso.
 */
export function horariosPorDiaComQuem(
  slots: ReadonlyArray<{ inicio: string; opcoes?: ReadonlyArray<{ principal_id: string; apoio_id: string | null }> }>,
  nomes: ReadonlyMap<string, string>,
  formatar: { dia: (d: Date) => string; hora: (d: Date) => string },
): Record<string, HorarioLivre[]> {
  const mapa: Record<string, HorarioLivre[]> = {};
  for (const s of slots) {
    const d = new Date(s.inicio);
    const primeira = s.opcoes?.[0];
    const opcao = primeira ? { principalId: primeira.principal_id, apoioId: primeira.apoio_id } : undefined;
    const quem = opcao ? rotuloDeQuem(opcao, nomes) : "";
    (mapa[formatar.dia(d)] ??= []).push({
      instante: s.inicio,
      rotulo: formatar.hora(d),
      ...(quem ? { quem } : {}),
      ...(opcao ? { opcao } : {}),
      ...(s.opcoes && s.opcoes.length > 1 ? { alternativas: s.opcoes.length - 1 } : {}),
    });
  }
  return mapa;
}

/** O que a pessoa escolheu no seletor: `null` em cada posição = "qualquer habilitada". */
export interface EscolhaDeProfissionais {
  principalId: string | null;
  apoioId: string | null;
}

/**
 * Só as combinações que respeitam a escolha — e o horário sem nenhuma SAI.
 *
 * Filtrar aqui, e não só pedir `professional_ids` à rota, é o que cobre a escolha
 * PARCIAL: num tipo que pede duas, "a Ana, com qualquer apoio" é um pedido
 * legítimo, e a rota recebe ids como conjunto completo. A rota devolve TODAS as
 * combinações de cada instante, então o recorte aqui é exato — não é amostra.
 *
 * Slot sem `opcoes` (servidor anterior à 0245) passa intacto: não há o que
 * filtrar, e sumir com ele apagaria a agenda inteira de quem ainda não atualizou.
 */
export function filtrarPorEscolha<
  S extends { opcoes?: ReadonlyArray<{ principal_id: string; apoio_id: string | null }> },
>(slots: ReadonlyArray<S>, escolha: EscolhaDeProfissionais): S[] {
  if (!escolha.principalId && !escolha.apoioId) return [...slots];
  const saida: S[] = [];
  for (const s of slots) {
    if (!s.opcoes) {
      saida.push(s);
      continue;
    }
    const opcoes = s.opcoes.filter(
      (o) =>
        (!escolha.principalId || o.principal_id === escolha.principalId) &&
        (!escolha.apoioId || o.apoio_id === escolha.apoioId),
    );
    if (opcoes.length > 0) saida.push({ ...s, opcoes });
  }
  return saida;
}

/**
 * Os ids que vão no POST de marcar.
 *
 * A opção que o horário MOSTROU vence — ela já respeita a escolha, porque os
 * horários passaram por `filtrarPorEscolha`. Sem opção (servidor velho), a
 * escolha explícita completa; sem nenhuma das duas, a rota decide, que é o
 * comportamento de antes.
 */
export function idsParaMarcar(
  escolha: EscolhaDeProfissionais,
  horario: Pick<HorarioLivre, "opcao">,
): string[] | undefined {
  if (horario.opcao) {
    return horario.opcao.apoioId ? [horario.opcao.principalId, horario.opcao.apoioId] : [horario.opcao.principalId];
  }
  const escolhidas = [escolha.principalId, escolha.apoioId].filter((x): x is string => Boolean(x));
  return escolhidas.length > 0 ? escolhidas : undefined;
}
