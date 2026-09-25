/**
 * QUEM ENTRA NO DISPARO — e, principalmente, quem NÃO entra e por quê.
 *
 * ═══ Por que as guardas rodam AQUI, e não só no envio ═══
 *
 * Porque o operador precisa ver o recorte ANTES de confirmar. "412 vão receber ·
 * 88 fora (61 sem telefone, 19 pediram para parar, 8 anonimizados)" é uma frase
 * que muda a decisão; descobrir o mesmo depois, na tela de resultado, não muda
 * nada — a mensagem já saiu. É o invariante 5: informação com propósito.
 *
 * O envio reconfere `is_blocked` mesmo assim, e não é redundância: a pessoa
 * responde "PARAR" no minuto 3 de uma campanha de 500, a ingestão grava
 * `is_blocked=true`, e só a checagem no envio honra isso já no próximo
 * destinatário em vez de no próximo disparo.
 *
 * ═══ A régua é UMA ═══
 *
 * `checarContato` de `lib/automation/guarda-do-contato.ts` — a mesma que a
 * automação usa. Reescrever as guardas aqui plantaria a segunda cópia que
 * aquele arquivo conta ter pago uma vez (o gate de consentimento nasceu numa
 * das duas ações irmãs e ficou esquecido na outra por meses).
 *
 * ═══ A dedupe por variante de telefone ═══
 *
 * Duas linhas de `contacts` podem apontar para a MESMA pessoa quando uma tem o
 * nono dígito e a outra não (`+5511999998888` vs `+551199998888`). O índice
 * único do banco não as vê como iguais — ele compara texto — e sem esta passada
 * a pessoa receberia a campanha duas vezes. `phoneLookupVariants` é a mesma
 * função que a ingestão usa para casar contato por telefone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { checarContato, type ContatoDoContexto } from "@/lib/automation/guarda-do-contato";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import type { MotivoDoPulo } from "@/lib/bulk-send/frases";
import { emLotes, LOTE_DE_FILTRO, PAGINA_DE_LEITURA } from "@/lib/lotes";

// ─── Sem teto de destinatários ──────────────────────────────────────────────
//
// Havia um `MAX_DESTINATARIOS = 500`, e o motivo real dele era de TRANSPORTE,
// não de produto: um `.in()` com milhares de ids estoura a URL, e a leitura do
// PostgREST corta em 1.000 linhas. Com as consultas em lotes e paginadas, o que
// limita uma campanha é o que deve limitá-la — o ritmo e o teto diário do
// número, que o motor aplica —, e não o tamanho da planilha.

/** As colunas que as guardas leem. Nem uma a mais — é PII. */
const COLUNAS = "id, phone_number, is_blocked, is_anonymized, is_merged_into, consent";

export interface LinhaDeDestinatario {
  contact_id: string;
  status: "pending" | "skipped";
  skip_reason: MotivoDoPulo | null;
}

export interface Recorte {
  linhas: LinhaDeDestinatario[];
  /** Quantos vão receber. */
  vaoReceber: number;
  /** Quantos ficaram de fora, por motivo — é o que a tela de confirmação mostra. */
  foraPorMotivo: Record<string, number>;
  /** Repetidos que nem viraram linha (mesma pessoa por variante de telefone). */
  repetidos: number;
  /** Ids pedidos que não existem nesta organização. */
  naoEncontrados: number;
}

/**
 * Monta o recorte a partir de ids de contato.
 *
 * `supabase` é o client do USUÁRIO (sob RLS), nunca o admin: é ele que garante
 * que um id de outra organização simplesmente não case, mesmo que alguém o
 * mande no corpo da requisição. Nenhum `organization_id` vem do body.
 */
export async function montarRecortePorIds(
  supabase: SupabaseClient,
  organizationId: string,
  contactIds: string[],
): Promise<Recorte> {
  const pedidos = [...new Set(contactIds)];
  if (pedidos.length === 0) return recorteVazio(0);

  const contatos: ContatoDoContexto[] = [];
  for (const lote of emLotes(pedidos, LOTE_DE_FILTRO)) {
    const { data, error } = await supabase
      .from("contacts")
      .select(COLUNAS)
      .eq("organization_id", organizationId)
      .in("id", lote);
    if (error) throw new Error(error.message);
    contatos.push(...((data ?? []) as unknown as ContatoDoContexto[]));
  }

  return recortarContatos(contatos, pedidos.length);
}

/**
 * Monta o recorte a partir de tags. A tela oferece isto como "todos os contatos
 * com a etiqueta X" — o caminho mais comum de quem não quer marcar 400 caixas.
 */
export async function montarRecortePorTags(
  supabase: SupabaseClient,
  organizationId: string,
  tags: string[],
): Promise<Recorte> {
  if (tags.length === 0) return recorteVazio(0);

  // PAGINADO: o PostgREST devolve no máximo 1.000 linhas por pedido, em
  // silêncio — uma etiqueta com 3.000 contatos virava campanha de 1.000 sem
  // ninguém saber. Ordenado por id para as páginas não se sobreporem.
  const contatos: ContatoDoContexto[] = [];
  for (let desde = 0; ; desde += PAGINA_DE_LEITURA) {
    const { data, error } = await supabase
      .from("contacts")
      .select(COLUNAS)
      .eq("organization_id", organizationId)
      // `overlaps` = tem QUALQUER uma das etiquetas. É o índice GIN de `tags`.
      .overlaps("tags", tags)
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA_DE_LEITURA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as unknown as ContatoDoContexto[];
    contatos.push(...pagina);
    if (pagina.length < PAGINA_DE_LEITURA) break;
  }

  return recortarContatos(contatos, contatos.length);
}

function recorteVazio(pedidos: number): Recorte {
  return {
    linhas: [],
    vaoReceber: 0,
    foraPorMotivo: {},
    repetidos: 0,
    naoEncontrados: pedidos,
  };
}

/**
 * A regra pura: uma lista de contatos entra, o recorte sai. Exportada porque é
 * o que os testes exercitam — sem banco, sem rede.
 */
export function recortarContatos(contatos: ContatoDoContexto[], pedidos: number): Recorte {
  const linhas: LinhaDeDestinatario[] = [];
  const foraPorMotivo: Record<string, number> = {};
  const telefonesVistos = new Set<string>();
  let repetidos = 0;
  let vaoReceber = 0;

  for (const contato of contatos) {
    const guarda = checarContato(contato);

    if (!guarda.ok) {
      // `no_contact` não acontece aqui (a lista veio do banco), mas o tipo o
      // admite; mapeá-lo para `contact_merged` mantém o CHECK do banco válido
      // em vez de gravar um motivo que ele recusa.
      const motivo: MotivoDoPulo =
        guarda.reason === "no_contact" ? "contact_merged" : guarda.reason;
      linhas.push({ contact_id: contato.id, status: "skipped", skip_reason: motivo });
      foraPorMotivo[motivo] = (foraPorMotivo[motivo] ?? 0) + 1;
      continue;
    }

    // Mesma pessoa por variante de nono dígito — o índice único do banco compara
    // TEXTO e não as veria como iguais.
    const variantes = phoneLookupVariants(guarda.contact.phone_number);
    if (variantes.some((v) => telefonesVistos.has(v))) {
      repetidos += 1;
      continue;
    }
    for (const v of variantes) telefonesVistos.add(v);

    linhas.push({ contact_id: contato.id, status: "pending", skip_reason: null });
    vaoReceber += 1;
  }

  return {
    linhas,
    vaoReceber,
    foraPorMotivo,
    repetidos,
    naoEncontrados: Math.max(0, pedidos - contatos.length),
  };
}
