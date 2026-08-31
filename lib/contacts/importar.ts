/**
 * IMPORTAR CONTATOS DE UMA PLANILHA — a regra, fora da rota.
 *
 * ═══ Por que saiu de `app/api/v1/contacts/import/route.ts` ═══
 *
 * Porque o disparo em massa precisa da MESMA importação, e precisa de uma coisa
 * que a rota não devolvia: o ID de quem já existia.
 *
 * A rota conta duplicado e segue — para ela isso basta, o objetivo é "criar os
 * que faltam". Para uma campanha o duplicado é justamente quem MAIS deve
 * receber: é o cliente que já está na base. Devolver só os criados faria a
 * planilha de 400 nomes disparar para os 12 que eram novos, em silêncio, e o
 * operador só descobriria contando.
 *
 * Então a função devolve `contatos[]` com TODOS os que a planilha resolveu —
 * criados e já existentes, marcados por `criado` — mais o mesmo resumo de
 * antes, para a rota seguir respondendo o que sempre respondeu.
 *
 * ═══ O que NÃO mudou ═══
 *
 * Desfecho POR LINHA, insert linha a linha (os índices únicos parciais de
 * `contacts` fariam um insert em lote virar tudo-ou-nada, e o 23505 de UM
 * conflito descartaria as outras centenas), pré-filtro de duplicados por
 * variante de telefone, e o `emit_event('contact.created')` de sempre — quem
 * consome não distingue importado de manual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { encryptCpfSql, hashCpf } from "@/lib/contacts/cpf";
import { CSV_MAX_DATA_ROWS, mapHeader, mapLinha, parseCsv } from "@/lib/contacts/csv";
import { logger } from "@/lib/logger";
import { contactCreateSchema, isValidCpf } from "@/lib/schemas";

export const SOURCE_IMPORT_CSV = "import_csv";

export interface LinhaErro {
  linha: number;
  motivo: string;
}

/** Um contato que a planilha resolveu — novo ou já existente. */
export interface ContatoDaPlanilha {
  id: string;
  linha: number;
  criado: boolean;
}

export interface ResumoDaImportacao {
  total_linhas: number;
  imported: number;
  skipped_duplicates: number;
  /**
   * Linha repetida DENTRO do próprio arquivo (mesmo telefone/email de uma
   * linha anterior) — diferente de `skipped_duplicates`, que é contra o
   * banco. Sem este contador, o "recorte" da tela de disparo (que soma
   * repetição sobre a LISTA DE IDS já deduplicada) nunca vê essa repetição:
   * ela já foi descartada aqui, em silêncio, antes de virar um id.
   */
  repeated_in_file: number;
  errors: LinhaErro[];
}

export interface ResultadoDaImportacao {
  resumo: ResumoDaImportacao;
  /** Todos os resolvidos, na ordem da planilha. Vazio quando nada passou. */
  contatos: ContatoDaPlanilha[];
}

/** Recusa de forma do arquivo, antes de qualquer parse. `null` = segue. */
export function recusaDeFormato(nome: string, tipo: string): string | null {
  const ok =
    nome.toLowerCase().endsWith(".csv") ||
    tipo === "text/csv" ||
    tipo === "application/vnd.ms-excel";
  return ok
    ? null
    : "Formato não suportado — envie um arquivo .csv. No Excel use 'Salvar como' → 'CSV UTF-8'.";
}

/** Recusa de conteúdo. `null` = as linhas de dados estão prontas. */
export function prepararLinhas(
  texto: string,
):
  | { erro: string; detalhe?: Record<string, unknown> }
  | { erro: null; indices: Record<string, number>; dataRows: string[][] } {
  const rows = parseCsv(texto);
  if (rows.length < 2) return { erro: "CSV vazio ou sem linhas de dados." };

  const header = rows[0]!;
  const mapeado = mapHeader(header);
  if (mapeado.motivo !== null) {
    return { erro: `Cabeçalho inválido: ${mapeado.motivo}.`, detalhe: { header: header.join(", ") } };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > CSV_MAX_DATA_ROWS) {
    return { erro: `Máximo de ${CSV_MAX_DATA_ROWS} linhas por importação — divida a planilha.` };
  }
  return { erro: null, indices: mapeado.indices, dataRows };
}

/**
 * Importa as linhas já preparadas.
 *
 * `supabase` é o client do USUÁRIO (sob RLS), nunca o admin: é ele que garante
 * que um contato de outra organização não possa ser tocado, mesmo que um id
 * alheio apareça no caminho.
 */
export async function importarLinhas(
  supabase: SupabaseClient,
  entrada: {
    organizationId: string;
    userId: string;
    indices: Record<string, number>;
    dataRows: string[][];
    requestId: string;
  },
): Promise<ResultadoDaImportacao> {
  const { organizationId: orgId, userId, indices, dataRows, requestId } = entrada;

  const candidatos: Array<{ linha: number; contato: Record<string, unknown> }> = [];
  const errors: LinhaErro[] = [];
  const vistosNoArquivo = new Set<string>();
  let repeatedInFile = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const linha = i + 2; // 1-based contando o cabeçalho — bate com o editor de planilhas.
    const { contato, motivo } = mapLinha(dataRows[i]!, indices);
    if (motivo !== null) {
      errors.push({ linha, motivo });
      continue;
    }
    if (contato.cpf && !isValidCpf(contato.cpf)) {
      errors.push({ linha, motivo: `CPF inválido: "${contato.cpf}"` });
      continue;
    }
    const chave = contato.phone_number ?? `email:${(contato.email as string).toLowerCase()}`;
    if (vistosNoArquivo.has(chave)) {
      repeatedInFile += 1;
      continue; // repetido DENTRO do arquivo — duplicado, sem ruído de erro.
    }
    vistosNoArquivo.add(chave);

    const parsed = contactCreateSchema.safeParse({ ...contato, source: SOURCE_IMPORT_CSV });
    if (!parsed.success) {
      errors.push({ linha, motivo: parsed.error.issues[0]?.message ?? "dados inválidos" });
      continue;
    }
    candidatos.push({ linha, contato: parsed.data as Record<string, unknown> });
  }

  if (candidatos.length === 0) {
    return {
      resumo: {
        total_linhas: dataRows.length,
        imported: 0,
        skipped_duplicates: 0,
        repeated_in_file: repeatedInFile,
        errors,
      },
      contatos: [],
    };
  }

  // ─── Pré-filtro de duplicados contra o banco ────────────────────────────────
  //
  // Os índices únicos são PARCIAIS (excluem mesclados/anonimizados), então a
  // busca espelha o WHERE do índice — filtrar pelo que o índice não cobre
  // produziria "duplicado" imaginário.
  //
  // Diferença em relação à versão que vivia na rota: o mapa guarda o ID, não só
  // a existência. É o que permite ao disparo em massa incluir quem já estava na
  // base — que é exatamente quem mais deve receber a campanha.
  const phones = candidatos
    .map((c) => c.contato.phone_number as string | undefined)
    .filter((p): p is string => typeof p === "string");
  const emails = candidatos
    .map((c) => c.contato.email as string | undefined)
    .filter((e): e is string => typeof e === "string");

  const existentes = new Map<string, string>();
  if (phones.length > 0) {
    const lookup = [...new Set(phones.flatMap((p) => phoneLookupVariants(p)))];
    const { data } = await supabase
      .from("contacts")
      .select("id, phone_number")
      .eq("organization_id", orgId)
      .not("phone_number", "is", null)
      .in("phone_number", lookup);
    for (const r of data ?? []) {
      const row = r as { id: string; phone_number: string };
      for (const v of phoneLookupVariants(row.phone_number)) existentes.set(`tel:${v}`, row.id);
    }
  }
  if (emails.length > 0) {
    const { data } = await supabase
      .from("contacts")
      .select("id, email_normalized")
      .eq("organization_id", orgId)
      .in(
        "email_normalized",
        emails.map((e) => e.toLowerCase()),
      );
    for (const r of data ?? []) {
      const row = r as { id: string; email_normalized: string };
      existentes.set(`email:${row.email_normalized}`, row.id);
    }
  }

  // ─── Insert linha a linha com desfecho individual ───────────────────────────
  const contatos: ContatoDaPlanilha[] = [];
  let imported = 0;
  let skippedDuplicates = 0;

  for (const { linha, contato } of candidatos) {
    const phone = contato.phone_number as string | undefined;
    const email = contato.email as string | undefined;

    const jaExiste =
      (phone && phoneLookupVariants(phone).map((v) => existentes.get(`tel:${v}`)).find(Boolean)) ||
      (email ? existentes.get(`email:${email.toLowerCase()}`) : undefined);

    if (jaExiste) {
      skippedDuplicates += 1;
      contatos.push({ id: jaExiste, linha, criado: false });
      continue;
    }

    const insertRow: Record<string, unknown> = {
      organization_id: orgId,
      created_by_user_id: userId,
      name: contato.name ?? null,
      display_name: contato.display_name ?? null,
      email: contato.email ?? null,
      phone_number: contato.phone_number ?? null,
      birthdate: contato.birthdate ?? null,
      tags: contato.tags ?? [],
      source: SOURCE_IMPORT_CSV,
      source_metadata: {},
      consent: {},
    };
    if (contato.cpf) {
      insertRow.cpf_hash = hashCpf(contato.cpf as string);
      // LGPD: além do hash (dedupe), grava a versão cifrada — igual ao create
      // unitário, senão o contato importado nasce sem CPF recuperável.
      const enc = await encryptCpfSql(supabase, contato.cpf as string);
      if (enc) insertRow.cpf_encrypted = enc;
    }

    const { data: criado, error: insErr } = await supabase
      .from("contacts")
      .insert(insertRow)
      .select("id, display_name, phone_number")
      .single();

    if (insErr) {
      // Conflito de corrida com os índices únicos = duplicado, não erro. Aqui a
      // linha perde o ID (o insert não devolve o vencedor da corrida) e por isso
      // NÃO entra em `contatos`: é raro, e incluir um id adivinhado seria pior.
      if (insErr.code === "23505") {
        skippedDuplicates += 1;
        continue;
      }
      errors.push({ linha, motivo: insErr.message });
      continue;
    }

    const novo = criado as { id: string };
    imported += 1;
    contatos.push({ id: novo.id, linha, criado: true });
    if (phone) existentes.set(`tel:${phone}`, novo.id);
    if (email) existentes.set(`email:${email.toLowerCase()}`, novo.id);

    // Mesmo evento do create unitário — quem consome `contact.created`
    // (workers, métricas) trata importado e manual igual.
    const { error: evErr } = await supabase.rpc("emit_event", {
      p_event_type: "contact.created",
      p_entity_kind: "contact",
      p_entity_id: novo.id,
      p_payload: {
        source: SOURCE_IMPORT_CSV,
        has_email: !!contato.email,
        has_phone: !!contato.phone_number,
        has_cpf: !!contato.cpf,
      },
      p_metadata: { request_id: requestId, actor_type: "user" },
      p_organization_id: orgId,
    });
    if (evErr) {
      logger.error("[contacts.importar] emit_event falhou", { causa: evErr.message, requestId });
    }
  }

  return {
    resumo: {
      total_linhas: dataRows.length,
      imported,
      skipped_duplicates: skippedDuplicates,
      repeated_in_file: repeatedInFile,
      errors,
    },
    contatos,
  };
}
