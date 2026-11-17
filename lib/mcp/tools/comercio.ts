/**
 * Capacidades de COMÉRCIO — o que o cliente já comprou e o que existe à venda.
 *
 * Ficou de fora do épico até ser cobrado, e era a lacuna mais direta do pilar 1:
 * um agente de vendas que não enxerga o catálogo nem o histórico de pedidos
 * negocia no escuro — promete o que não existe, ou repete uma oferta que o
 * cliente já comprou.
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente, e a
 * fonte é sempre `ctx.organizationId` (token/cookie), NUNCA o input.
 */
import { z } from "zod";

import { reordenarItens } from "@/lib/ai/rerank/openrouter";

import type { McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// pedidos de um cliente
// ---------------------------------------------------------------------------

const pedidosInputShape = {
  contact_id: z.string().uuid().describe("O cliente cujos pedidos se quer ver."),
  limite: z.number().int().min(1).max(20).optional().default(10),
};

export const crmListContactOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_list_contact_orders",
  description:
    "Lista os pedidos de um contato, do mais recente para o mais antigo, com status, valor, " +
    "forma de pagamento, situação de entrega e código de rastreio. Use antes de prometer prazo " +
    "ou repetir oferta: o cliente pode já ter comprado.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("orders")
      .select(
        "id, external_id, external_provider, status, total_cents, currency, payment_method, fulfillment_status, tracking_code, ordered_at, is_anonymized",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", input.contact_id)
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .limit(input.limite);

    if (error) throw new Error(`listar_pedidos_falhou: ${error.message}`);

    return {
      pedidos: (data ?? []).map((p) => ({
        ...p,
        // Pedido anonimizado por LGPD continua contando para histórico, mas o
        // conteúdo não volta: dizer isso é melhor que devolver campos vazios e
        // deixar o modelo concluir que o cliente nunca comprou.
        ...(p.is_anonymized ? { aviso: "pedido anonimizado a pedido do titular" } : {}),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// buscar no catálogo
// ---------------------------------------------------------------------------

/** Quantos candidatos o banco devolve para o rerank escolher. */
export const CANDIDATOS_DE_PRODUTO = 40;

const PALAVRAS_VAZIAS_DO_PRODUTO = new Set([
  "de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "um", "uma", "com", "sem",
  "para", "pra", "por", "no", "na", "nos", "nas", "em", "tem", "voces", "vocês", "quero",
  "queria", "algum", "alguma", "qual", "quais", "que", "preço", "preco", "valor",
]);

/**
 * Palavras do termo que valem para o `ilike`. Mantém acento (o catálogo grava
 * "Calça", e "calca" não casaria) e só letra/dígito — o filtro `or` do
 * PostgREST usa vírgula e parêntese como sintaxe, e um termo com eles quebraria
 * a consulta inteira.
 */
export function palavrasDoProduto(termo: string): string[] {
  const vistas = new Set<string>();
  for (const bruta of termo.toLowerCase().split(/\s+/)) {
    const limpa = bruta.replace(/[^\p{L}\p{N}]/gu, "");
    if (limpa.length < 2 || PALAVRAS_VAZIAS_DO_PRODUTO.has(limpa)) continue;
    vistas.add(limpa);
    if (vistas.size >= 6) break;
  }
  return [...vistas];
}

/** Texto do produto sem HTML, curto — o que o rerank lê. */
export function textoDoProduto(p: { title: string | null; description: string | null }): string {
  const descricao = (p.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return `${p.title ?? ""}
${descricao}`.slice(0, 600);
}

/**
 * Ordem sem rerank: mais palavras no TÍTULO primeiro, depois na descrição.
 * Nunca pior que o `ilike` antigo, que só achava o termo inteiro no título.
 */
export function ordenarPorCasamento<T extends { title: string | null; description: string | null }>(
  produtos: readonly T[],
  palavras: readonly string[],
): T[] {
  const nota = (p: T) => {
    const titulo = (p.title ?? "").toLowerCase();
    const descricao = (p.description ?? "").toLowerCase();
    let n = 0;
    for (const w of palavras) {
      if (titulo.includes(w)) n += 10;
      else if (descricao.includes(w)) n += 1;
    }
    return n;
  };
  return produtos
    .map((p, i) => ({ p, i, n: nota(p) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.p);
}

const produtosInputShape = {
  termo: z
    .string()
    .trim()
    .min(2)
    .describe("O que o cliente procura, com as palavras dele (ex.: \"vestido longo azul\")."),
  limite: z.number().int().min(1).max(20).optional().default(10),
  somente_disponiveis: z.boolean().optional().default(true),
};

export const crmSearchProducts: McpToolDefinition<typeof produtosInputShape> = {
  name: "crm_search_products",
  description:
    "Busca produtos do catálogo da loja pelo que o cliente descreveu (nome, cor, modelo, uso). " +
    "Devolve os mais parecidos primeiro, com preço, quantidade disponível e link. Use para " +
    "responder preço e disponibilidade com o dado da loja em vez de estimar.",
  inputSchema: produtosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const palavras = palavrasDoProduto(input.termo);
    // Qualquer palavra no título OU na descrição vira candidato; quem decide a
    // ordem é o rerank (ou a contagem de palavras, sem chave). O `ilike` do
    // termo inteiro só no título perdia "vestido azul" para "Vestido Longo Azul".
    const filtro = (palavras.length > 0 ? palavras : [input.termo.replace(/[^\p{L}\p{N} ]/gu, "")])
      .filter((w) => w.trim().length > 0)
      .flatMap((w) => [`title.ilike.%${w}%`, `description.ilike.%${w}%`])
      .join(",");

    let q = ctx.supabase
      .from("nuvemshop_products")
      .select("id, external_id, title, description, price_cents, available_qty, url, image_url")
      .eq("organization_id", ctx.organizationId)
      .limit(CANDIDATOS_DE_PRODUTO);
    if (filtro) q = q.or(filtro);

    // Oferecer o que está sem estoque é pior que não achar: o cliente ouve um
    // sim e recebe um não depois.
    if (input.somente_disponiveis) q = q.gt("available_qty", 0);

    const { data, error } = await q;
    if (error) throw new Error(`buscar_produtos_falhou: ${error.message}`);

    const candidatos = ordenarPorCasamento(data ?? [], palavras);
    const { itens, reordenado } = await reordenarItens({
      organizationId: ctx.organizationId,
      query: input.termo,
      itens: candidatos,
      texto: textoDoProduto,
      topN: input.limite,
      ponto: "produtos",
    });

    return {
      produtos: itens.map(({ relevancia, ...p }) => (reordenado ? { ...p, relevancia } : p)),
      ...(itens.length === 0
        ? { aviso: input.somente_disponiveis ? "nada parecido em estoque" : "nada parecido no catálogo" }
        : {}),
    };
  },
};
