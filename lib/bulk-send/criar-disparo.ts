/**
 * Criar um disparo — a regra, num lugar só.
 *
 * ## Por que ela saiu de dentro da rota
 *
 * Esta sequência — achar a conexão, conferir se ela permite o modo, pré-voar o
 * contrato do modelo, montar o recorte da lista, gravar o disparo e as linhas —
 * vivia inteira dentro do `POST /api/v1/bulk-sends`. Enquanto o único jeito de
 * criar um disparo era pela tela, isso não custava nada.
 *
 * O bloco de fluxo "Disparo em massa" é o segundo jeito. Reescrever a sequência
 * dentro dele produziria duas implementações da mesma regra, e a segunda
 * divergiria na primeira mudança — exatamente o defeito que `lib/bulk-send/
 * montagem.ts` já documenta sobre `checarContato`, e que `escolherPorRodizio`
 * documenta sobre o rodízio. A regra que decide QUEM recebe uma campanha é o
 * pior lugar possível para duas versões.
 *
 * ## Sobre o cliente que chega aqui
 *
 * A função aceita qualquer `SupabaseClient` — o da sessão (rota) ou o admin
 * (motor de fluxos). O `organizationId` vem SEMPRE de fonte confiável de quem
 * chama: o cookie validado na rota, a linha da execução no motor. Nunca do
 * corpo do pedido nem do config do bloco. É a mesma disciplina do
 * `supabase-adapter.ts` do flow-engine, e é o que mantém o bypass de RLS honesto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { recusaDeModo } from "@/lib/bulk-send/modo";
import {
  montarRecortePorIds,
  montarRecortePorTags,
  MAX_DESTINATARIOS,
  type Recorte,
} from "@/lib/bulk-send/montagem";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import type { ChannelProvider } from "@/lib/channels/capabilities";
import { conferirDefinicao } from "@/lib/channels/conferir-definicao";
import type { CriarDisparoInput } from "@/lib/schemas/bulk-sends";

/** Quem criou o disparo. Uma das duas, nunca as duas. */
export type AutorDoDisparo =
  | { tipo: "pessoa"; userId: string }
  /** Um bloco de fluxo. `flowExecutionId` é o rastro de qual execução o criou. */
  | { tipo: "fluxo"; flowExecutionId: string };

/**
 * Os motivos de recusa, em código.
 *
 * Códigos, e não frases prontas de HTTP: quem chama decide o que fazer com
 * cada um. A rota vira 404/409/422; o bloco de fluxo vira ramo e aviso na
 * Central. Devolver `Response` daqui amarraria a regra ao protocolo.
 */
export type RecusaDeDisparo =
  | { codigo: "conexao_nao_encontrada"; mensagem: string }
  | { codigo: "conexao_arquivada"; mensagem: string }
  | { codigo: "modo_incompativel"; mensagem: string }
  | { codigo: "modelo_invalido"; mensagem: string }
  | { codigo: "sem_destinatario"; mensagem: string; recorte: Recorte }
  | { codigo: "lista_grande_demais"; mensagem: string; recorte: Recorte }
  | { codigo: "falha_ao_gravar"; mensagem: string };

export type ResultadoDeCriacao =
  | { ok: true; disparoId: string; recorte: Recorte; provider: ChannelProvider }
  | { ok: false; recusa: RecusaDeDisparo };

export async function criarDisparo(
  supabase: SupabaseClient,
  deps: { organizationId: string; autor: AutorDoDisparo },
  entrada: CriarDisparoInput,
): Promise<ResultadoDeCriacao> {
  const orgId = deps.organizationId;

  // ─── A conexão, e o modo que ELA permite ────────────────────────────────────
  const select = (comArchived: boolean) =>
    `id, provider, status${comArchived ? `, ${ARCHIVED_AT}` : ""}`;
  const { data: sessaoRaw } = await queryTolerantToMissingArchived(
    () =>
      supabase
        .from("channel_sessions")
        .select(select(true))
        .eq("id", entrada.channel_session_id)
        .eq("organization_id", orgId)
        .maybeSingle(),
    () =>
      supabase
        .from("channel_sessions")
        .select(select(false))
        .eq("id", entrada.channel_session_id)
        .eq("organization_id", orgId)
        .maybeSingle(),
  );
  const sessao = sessaoRaw as unknown as
    | { id: string; provider: ChannelProvider; status: string; archived_at?: string | null }
    | null;

  if (!sessao) {
    return {
      ok: false,
      recusa: {
        codigo: "conexao_nao_encontrada",
        mensagem: "Conexão não encontrada nesta organização.",
      },
    };
  }
  if (sessao.archived_at) {
    return {
      ok: false,
      recusa: {
        codigo: "conexao_arquivada",
        mensagem: "Essa conexão foi excluída da Central de Conexões. Escolha outra.",
      },
    };
  }

  // O modo é consequência da conexão, nunca uma segunda pergunta — ver
  // `lib/bulk-send/modo.ts`. A tela nem oferece a combinação impossível; este
  // gate é para quem chegou pela API ou por um bloco de fluxo.
  const recusa = recusaDeModo(sessao.provider, entrada.mode);
  if (recusa) {
    return { ok: false, recusa: { codigo: "modo_incompativel", mensagem: recusa } };
  }

  // ─── Pré-voo do contrato do modelo, uma vez ────────────────────────────────
  //
  // `conferirDefinicao` roda de novo por mensagem dentro do `sendMessageHandler`
  // — a Meta pode pausar a definição entre a criação e o envio. Aqui ela evita
  // 500 falhas idênticas achadas uma a uma.
  if (entrada.mode === "template") {
    try {
      await conferirDefinicao(supabase, {
        organizationId: orgId,
        channelSessionId: entrada.channel_session_id,
        name: entrada.template_name ?? "",
        language: entrada.template_language ?? "",
        values: entrada.template_values,
      });
    } catch (err) {
      // As frases de `conferirDefinicao` já são acionáveis em pt-BR
      // ("X espera 2 valor(es) — falta: body_2"). Repassar verbatim.
      return {
        ok: false,
        recusa: {
          codigo: "modelo_invalido",
          mensagem:
            err instanceof Error ? err.message : "O modelo escolhido não pôde ser conferido.",
        },
      };
    }
  }

  // ─── O recorte da lista ────────────────────────────────────────────────────
  let recorte: Recorte;
  try {
    recorte =
      entrada.audiencia.kind === "tags"
        ? await montarRecortePorTags(supabase, orgId, entrada.audiencia.tags)
        : await montarRecortePorIds(supabase, orgId, entrada.audiencia.contact_ids);
  } catch (err) {
    return {
      ok: false,
      recusa: {
        codigo: "falha_ao_gravar",
        mensagem: err instanceof Error ? err.message : "falha ao montar a lista",
      },
    };
  }

  if (recorte.vaoReceber === 0) {
    // Campanha que não fala com ninguém não nasce: ela viraria um disparo
    // "concluído" com zero enviados, e isso se lê como sucesso.
    return {
      ok: false,
      recusa: {
        codigo: "sem_destinatario",
        mensagem:
          "Nenhum contato desta lista pode receber a mensagem. Confira os motivos e escolha outra lista.",
        recorte,
      },
    };
  }
  if (recorte.vaoReceber > MAX_DESTINATARIOS) {
    return {
      ok: false,
      recusa: {
        codigo: "lista_grande_demais",
        mensagem: `Máximo de ${MAX_DESTINATARIOS} destinatários por disparo — divida a lista.`,
        recorte,
      },
    };
  }

  // ─── Cria o disparo e a lista ──────────────────────────────────────────────
  const { data: criado, error: erroDisparo } = await supabase
    .from("bulk_sends")
    .insert({
      organization_id: orgId,
      name: entrada.name,
      status: "draft",
      channel_session_id: entrada.channel_session_id,
      // Cópia congelada: re-parear o número depois não muda o que esta campanha é.
      provider: sessao.provider,
      mode: entrada.mode,
      body: entrada.body ?? null,
      template_name: entrada.template_name ?? null,
      template_language: entrada.template_language ?? null,
      template_values: entrada.template_values,
      interval_ms: entrada.interval_ms,
      scheduled_for: entrada.scheduled_for ?? null,
      created_by_user_id: deps.autor.tipo === "pessoa" ? deps.autor.userId : null,
      // O rastro de qual fluxo criou. Sem ele a campanha aparece na tela sem
      // dono e sem origem, e ninguém sabe qual fluxo desligar (migration 0209).
      created_by_flow_execution_id:
        deps.autor.tipo === "fluxo" ? deps.autor.flowExecutionId : null,
    })
    .select("id")
    .single();

  if (erroDisparo || !criado) {
    return {
      ok: false,
      recusa: {
        codigo: "falha_ao_gravar",
        mensagem: erroDisparo?.message ?? "bulk_send_insert_failed",
      },
    };
  }
  const disparoId = (criado as { id: string }).id;

  const { error: erroLinhas } = await supabase.from("bulk_send_recipients").insert(
    recorte.linhas.map((l) => ({
      organization_id: orgId,
      bulk_send_id: disparoId,
      contact_id: l.contact_id,
      status: l.status,
      skip_reason: l.skip_reason,
    })),
  );
  if (erroLinhas) {
    // O disparo sem lista é lixo que confunde a tela; apagar aqui é seguro
    // porque ele nasceu nesta chamada e ninguém mais o viu.
    await supabase.from("bulk_sends").delete().eq("id", disparoId).eq("organization_id", orgId);
    return { ok: false, recusa: { codigo: "falha_ao_gravar", mensagem: erroLinhas.message } };
  }

  return { ok: true, disparoId, recorte, provider: sessao.provider };
}
