/**
 * A busca global: contato, conversa e lead, numa chamada só.
 *
 * ── Por que este handler existe ──────────────────────────────────────────────
 *
 * A caixa do cabeçalho (⌘K) achava só PÁGINAS — os destinos do registro de
 * navegação. Ela parecia uma busca completa e não era: quem digitava o nome de
 * um cliente não achava nada, e concluía que o cliente não estava cadastrado.
 *
 * ── O que ficou de FORA, e é declarado ───────────────────────────────────────
 *
 * O CONTEÚDO das mensagens. Buscar dentro do texto de `messages` exigiria um
 * índice GIN trigram na tabela mais ESCRITA do produto — custo de escrita
 * permanente, pago por toda instalação, para uma conveniência de leitura. A
 * conversa é alcançada pelo CONTATO dela, que responde ao caso real ("abre a
 * conversa do João") sem tocar naquele índice. Se um dia o conteúdo entrar, ele
 * vem em onda própria, com a tripla de migration.
 *
 * ── Isolamento: RLS E filtro explícito, os dois ──────────────────────────────
 *
 * O cliente aqui é o do USUÁRIO (`lib/supabase/server`), então a RLS já recorta
 * por organização. O `.eq("organization_id", …)` explícito não é redundância
 * decorativa: quem pertence a mais de uma organização veria, só com a RLS, as
 * linhas de TODAS elas — a RLS responde "esta pessoa pode ver?", e a pergunta
 * desta busca é "o que existe na organização em que ela está AGORA?".
 * `tests/invariants/busca-global-nao-vaza-entre-organizacoes.test.ts` mede as
 * duas pontas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SearchQuery, SearchResult } from "@/lib/schemas/search";

/**
 * ⚠️ O ESCAPE NÃO É OPCIONAL, e não foi inventado aqui: é o mesmo de
 * `app/api/v1/contacts/_handler.ts` e de `conversations/_handler.ts`.
 *
 * `%` e `_` são curingas do LIKE — sem escapar, quem digita "100%" pede uma
 * varredura da tabela inteira. E `,`, `(`, `)` são delimitadores do DSL do
 * `.or()` do PostgREST: um nome com vírgula ("Silva, Maria") INJETA uma condição
 * a mais na string do filtro. Vira espaço porque o objetivo é achar a pessoa,
 * não recusar o caractere.
 */
function paraFiltro(bruto: string): string {
  return bruto
    .trim()
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/[,()]/g, " ");
}

/** Corta o subtítulo no que cabe numa linha da paleta, sem cortar no meio da palavra. */
function resumo(texto: string | null | undefined, max = 80): string | null {
  const limpo = (texto ?? "").trim();
  if (!limpo) return null;
  if (limpo.length <= max) return limpo;
  return `${limpo.slice(0, max - 1).trimEnd()}…`;
}

type Ctx = { organization_id: string };

/**
 * Nome de contato como a interface o mostra.
 *
 * ⚠️ `display_name` PRIMEIRO. Contato que entra pelo WhatsApp nasce só com ele
 * (o pushName do aparelho); `name` fica nulo até alguém editar à mão. A ordem
 * inversa mostraria vazio para a maioria dos contatos de uma instalação nova —
 * o mesmo defeito que `contacts/_handler.ts` documenta no filtro de busca.
 */
function nomeDoContato(c: { display_name?: string | null; name?: string | null }): string {
  return (c.display_name ?? "").trim() || (c.name ?? "").trim() || "—";
}

async function buscarContatos(
  supabase: SupabaseClient,
  ctx: Ctx,
  termo: string,
  limit: number,
): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name, display_name, phone_number, is_anonymized")
    .eq("organization_id", ctx.organization_id)
    .or(
      [
        `name.ilike.%${termo}%`,
        `display_name.ilike.%${termo}%`,
        `email.ilike.%${termo}%`,
        `phone_number.ilike.%${termo}%`,
      ].join(","),
    )
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((c) => ({
    kind: "contact" as const,
    id: c.id as string,
    // Contato anonimizado por LGPD não volta a ter nome aqui: o que o banco
    // guarda já é o rótulo anônimo, e é ele que a busca mostra.
    title: nomeDoContato(c),
    subtitle: resumo(c.phone_number as string | null),
    href: `/app/contacts/${c.id}`,
  }));
}

async function buscarConversas(
  supabase: SupabaseClient,
  ctx: Ctx,
  termo: string,
  limit: number,
): Promise<SearchResult[]> {
  // O filtro mora no CONTATO embutido, e é por isso que o join não é `left`:
  // `!inner` faz o `ilike` no contato recortar a lista de conversas. Sem ele, o
  // PostgREST devolveria toda conversa da organização com o contato nulo nas
  // que não casam — a busca pareceria achar tudo.
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, last_message_preview, last_message_at, contacts:contact_id!inner (id, name, display_name)",
    )
    .eq("organization_id", ctx.organization_id)
    .or(`name.ilike.%${termo}%,display_name.ilike.%${termo}%`, {
      referencedTable: "contacts",
    })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  type Linha = {
    id: string;
    last_message_preview: string | null;
    contacts: { name?: string | null; display_name?: string | null } | null;
  };

  return ((data ?? []) as unknown as Linha[]).map((c) => ({
    kind: "conversation" as const,
    id: c.id,
    title: nomeDoContato(c.contacts ?? {}),
    subtitle: resumo(c.last_message_preview),
    href: `/app/inbox/${c.id}`,
  }));
}

async function buscarLeads(
  supabase: SupabaseClient,
  ctx: Ctx,
  termo: string,
  limit: number,
): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("crm_leads")
    .select("id, title, description, pipeline_id, crm_stages:stage_id (name)")
    .eq("organization_id", ctx.organization_id)
    .or(`title.ilike.%${termo}%,description.ilike.%${termo}%`)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  type Linha = {
    id: string;
    title: string;
    description: string | null;
    pipeline_id: string;
    crm_stages: { name?: string | null } | null;
  };

  return ((data ?? []) as unknown as Linha[]).map((l) => ({
    kind: "lead" as const,
    id: l.id,
    title: l.title,
    // A ETAPA e não a descrição: "Proposta enviada" responde onde o negócio
    // está, que é a pergunta de quem busca um lead pelo nome.
    subtitle: resumo(l.crm_stages?.name ?? l.description),
    // `?lead=` é como a tela de funil abre um card — ver
    // `app/app/pipelines/[id]/_client.tsx:117` (`leadInicial`).
    href: `/app/pipelines/${l.pipeline_id}?lead=${l.id}`,
  }));
}

/**
 * As três buscas em PARALELO, e uma que falha não derruba as outras.
 *
 * `allSettled` e não `all`: um erro numa tabela (permissão, coluna ausente num
 * clone que não aplicou a última migration) devolveria a busca inteira vazia
 * com `all`, e quem digitou concluiria que não há nada cadastrado. Assim a
 * seção problemática some e as demais respondem — degradar é melhor que mentir.
 * O erro sobe para o Sentry pelo handler da rota.
 */
export async function buscaGlobalHandler(
  supabase: SupabaseClient,
  ctx: Ctx,
  q: SearchQuery,
): Promise<{ results: SearchResult[]; parciais: boolean }> {
  const termo = paraFiltro(q.q);
  if (!termo) return { results: [], parciais: false };

  const fatias = await Promise.allSettled([
    buscarContatos(supabase, ctx, termo, q.limit),
    buscarConversas(supabase, ctx, termo, q.limit),
    buscarLeads(supabase, ctx, termo, q.limit),
  ]);

  const results: SearchResult[] = [];
  let parciais = false;
  for (const f of fatias) {
    if (f.status === "fulfilled") results.push(...f.value);
    else parciais = true;
  }

  return { results, parciais };
}
