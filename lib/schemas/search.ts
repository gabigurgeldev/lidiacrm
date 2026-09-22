/**
 * Busca global — o que a caixa do cabeçalho (⌘K) manda para o servidor.
 *
 * ADR-03: Zod no boundary de TODA API route (Spec 09 §12).
 */
import { z } from "zod";

/**
 * O piso de 2 caracteres não é capricho de validação: é o que impede a busca de
 * varrer a base inteira a cada tecla. Uma letra casa com quase tudo, e o
 * resultado seria um `ilike '%a%'` por tabela em toda digitação.
 *
 * O teto de 80 é a outra ponta: texto colado de um e-mail inteiro não é busca,
 * e um `ilike` com 4 KB de padrão é um jeito barato de ocupar o Postgres de
 * quem hospeda.
 */
export const BUSCA_MIN = 2;
export const BUSCA_MAX = 80;

/**
 * `limit` é POR TIPO, não no total: a caixa mostra seções (Contatos, Conversas,
 * Leads) e um teto global faria a seção mais populosa engolir as outras — quem
 * tem 400 contatos nunca veria um lead.
 *
 * O teto de 10 existe porque nada além disso cabe na tela sem rolagem, e uma
 * paleta que rola deixa de ser uma paleta.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(BUSCA_MIN).max(BUSCA_MAX),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type SearchQuery = z.output<typeof searchQuerySchema>;

/** Os três tipos que a busca alcança hoje. Ver o handler para o que ficou fora. */
export const SEARCH_KINDS = ["contact", "conversation", "lead"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/**
 * Um resultado, já pronto para virar uma linha na paleta.
 *
 * ⚠️ O `href` é montado no SERVIDOR de propósito. A alternativa — devolver
 * `{ kind, id }` e deixar o cliente montar a URL — poria uma quarta lista de
 * rotas do produto dentro de um componente de UI, e ela envelheceria no dia em
 * que a tela de funil mudasse de endereço. Aqui ela fica ao lado da consulta que
 * sabe de qual funil o lead é.
 */
export type SearchResult = {
  readonly kind: SearchKind;
  readonly id: string;
  /** O que a linha mostra em destaque — nome do contato, título do lead. */
  readonly title: string;
  /** A segunda linha: telefone, última mensagem, etapa do funil. Pode faltar. */
  readonly subtitle: string | null;
  readonly href: string;
};
