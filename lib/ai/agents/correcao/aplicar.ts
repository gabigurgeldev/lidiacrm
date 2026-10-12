/**
 * Corrigir agente com IA — a ÚNICA escrita do fluxo: o que a pessoa manteve
 * marcado vira RASCUNHO do agente.
 *
 * Nunca publica. O agente no ar segue o mesmo até alguém abrir o editor, testar
 * e publicar; a versão anterior fica no histórico para reverter.
 *
 * De onde parte: a versão que a correção leu (`base_version_id`). Se ela deixou
 * de ser a vigente entre a proposta e o clique — alguém salvou ou publicou no
 * meio —, a aplicação é recusada (409) em vez de passar por cima do que mudou.
 *
 *   - base é RASCUNHO  → o próprio rascunho é atualizado (como o "Salvar" do
 *     editor faz — não infla a sequência de versões);
 *   - base é PUBLICADA → nasce um rascunho v(max+1), cópia da publicada com as
 *     mudanças.
 *
 * Por que não reusa `saveAgentDraftAction`: aquela é uma server action presa à
 * sessão do editor (cookies, `revalidatePath`) e grava o PATCH do formulário. A
 * correção grava sempre o conteúdo INTEIRO (a base copiada + as mudanças), pelo
 * mesmo `conteudoDaVersao` que os outros caminhos usam.
 *
 * `organizationId` vem de quem chama, resolvido da sessão — nunca do corpo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { capacidadesPorPacote, catalogoComHandler } from "@/lib/ai/agents/capacidades-padrao";
import { conteudoDaVersao } from "@/lib/ai/agents/conteudo-da-versao";
import { mensagemDoEscopo, validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { criarMaterialDeTexto } from "@/lib/ai/rag/criar-material";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";

import { carregarContextoDaCorrecao } from "./contexto";
import type { EntradaDaAplicacao } from "./esquemas";
import { propostaVazia, resumoDaCorrecao, versaoCorrigida } from "./montar";

export type ResultadoDaAplicacao =
  | {
      ok: true;
      version_id: string;
      version_number: number;
      /** true = o rascunho que já existia foi atualizado; false = nasceu um. */
      atualizou_rascunho: boolean;
      materiais: Array<{ id: string; nome: string }>;
      materiais_com_falha: Array<{ nome: string; motivo: string }>;
    }
  | { ok: false; status: number; code: string; message: string };

export async function aplicarCorrecao(
  admin: SupabaseClient,
  ctx: { organizationId: string; userId: string; requestId: string },
  agentId: string,
  entrada: EntradaDaAplicacao,
): Promise<ResultadoDaAplicacao> {
  const { organizationId: orgId, userId, requestId } = ctx;
  const recusa = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });

  const lido = await carregarContextoDaCorrecao(admin, orgId, agentId);
  if (!lido.ok) return recusa(lido.status, lido.code, lido.message);
  const { base } = lido.contexto;
  const { proposta, aceitar_prompt: aceitarPrompt } = entrada;

  if (base.id !== proposta.base_version_id) {
    return recusa(
      409,
      "state_conflict",
      "O agente mudou depois desta proposta (alguém salvou ou publicou). Peça a correção de novo.",
    );
  }
  if (!base.conteudo) {
    return recusa(
      422,
      "validation_failed",
      "A versão atual deste agente tem um campo fora do padrão. Abra-o no editor e salve uma vez antes de corrigir.",
    );
  }
  if (propostaVazia(proposta, aceitarPrompt, base.conteudo.system_prompt)) {
    return recusa(422, "validation_failed", "Nada ficou marcado para aplicar.");
  }

  // Só desliga material que está ligado na base (o resto é ignorado, não recusado).
  const ligados = new Set(base.conteudo.knowledge_source_ids ?? []);
  const propostaConferida = {
    ...proposta,
    materiais_desligar: proposta.materiais_desligar.filter((m) => ligados.has(m.valor)),
  };

  // ── Conferências que não escrevem nada ─────────────────────────────────────
  const catalogo = catalogoComHandler();
  const mapa = capacidadesPorPacote(catalogo);
  const ordem = catalogo.map((c) => c.name);
  const ensaio = versaoCorrigida(base.conteudo, propostaConferida, aceitarPrompt, mapa, { ordemDoCatalogo: ordem });
  if (ensaio.tool_ids.length > TETO_TOOLS_POR_AGENTE) {
    return recusa(
      422,
      "validation_failed",
      `Com estas capacidades o agente passaria de ${TETO_TOOLS_POR_AGENTE} ferramentas. Desmarque algum pacote.`,
    );
  }
  if (!versionCreateSchema.safeParse(ensaio).success) {
    return recusa(422, "validation_failed", "A versão corrigida não é válida. Revise o prompt e as mudanças.");
  }

  // ── Materiais novos ────────────────────────────────────────────────────────
  const materiais: Array<{ id: string; nome: string }> = [];
  const materiaisComFalha: Array<{ nome: string; motivo: string }> = [];
  for (const m of propostaConferida.materiais_novos) {
    const r = await criarMaterialDeTexto(admin, orgId, {
      tipo: m.tipo,
      nome: m.nome,
      itens: m.itens?.map((i) => ({ question: i.pergunta, answer: i.resposta })),
      texto: m.texto,
      renomearSeEmUso: true,
      metadata: { criado_por: "correcao_com_ia", agent_id: agentId },
    });
    if (r.ok) materiais.push({ id: r.id, nome: r.nome });
    else materiaisComFalha.push({ nome: m.nome, motivo: r.mensagem });
  }

  const final = versionCreateSchema.safeParse(
    versaoCorrigida(base.conteudo, propostaConferida, aceitarPrompt, mapa, {
      ordemDoCatalogo: ordem,
      idsDosMateriaisNovos: materiais.map((m) => m.id),
    }),
  );
  if (!final.success) return recusa(500, "internal_error", "Não consegui montar a versão corrigida.");
  const v = final.data;

  const escopo = await validarEscopoDaVersao(admin, orgId, {
    pipeline_ids: v.pipeline_ids,
    knowledge_source_ids: v.knowledge_source_ids,
    api_endpoint_ids: v.api_endpoint_ids,
  });
  if (!escopo.ok) return recusa(422, "validation_failed", mensagemDoEscopo(escopo));

  const changeSummary = resumoDaCorrecao(entrada.problema);

  // ── Rascunho ───────────────────────────────────────────────────────────────
  let versionId: string | null = null;
  let versionNumber = base.version_number;
  const atualizouRascunho = base.status === "draft";
  if (atualizouRascunho) {
    const { data, error } = await admin
      .from("ai_agent_versions")
      .update({ ...conteudoDaVersao(v), change_summary: changeSummary })
      .eq("id", base.id)
      .eq("organization_id", orgId)
      .eq("status", "draft")
      .select("id, version_number")
      .maybeSingle();
    if (error) return recusa(500, "internal_error", "Erro ao salvar o rascunho corrigido.");
    if (!data) return recusa(409, "state_conflict", "O rascunho foi publicado ou apagado no meio. Peça a correção de novo.");
    versionId = (data as { id: string }).id;
  } else {
    for (let tentativa = 0; tentativa < 3 && versionId === null; tentativa++) {
      const { data: maior } = await admin
        .from("ai_agent_versions")
        .select("version_number")
        .eq("agent_id", agentId)
        .eq("organization_id", orgId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const proximo = ((maior as { version_number?: number } | null)?.version_number ?? 0) + 1;
      const { data, error } = await admin
        .from("ai_agent_versions")
        .insert({
          organization_id: orgId,
          agent_id: agentId,
          version_number: proximo,
          ...conteudoDaVersao(v),
          change_summary: changeSummary,
          status: "draft",
          created_by: userId,
        })
        .select("id, version_number")
        .single();
      if (!error && data) {
        versionId = (data as { id: string }).id;
        versionNumber = (data as { version_number: number }).version_number;
      } else if (error?.code !== "23505") {
        return recusa(500, "internal_error", "Erro ao criar o rascunho corrigido.");
      }
    }
    if (versionId === null) return recusa(500, "internal_error", "Conflito de versionamento. Tente de novo.");
  }

  void audit({
    action: "ai_agent.correcao_aplicada",
    actorUserId: userId,
    organizationId: orgId,
    resourceType: "ai_agent_version",
    resourceId: versionId,
    requestId,
    metadata: {
      agent_id: agentId,
      base_version_id: base.id,
      atualizou_rascunho: atualizouRascunho,
      prompt_mudou: aceitarPrompt && proposta.system_prompt.trim() !== base.conteudo.system_prompt.trim(),
      materiais_criados: materiais.map((m) => m.id),
      materiais_com_falha: materiaisComFalha.length,
      materiais_desligados: propostaConferida.materiais_desligar.map((m) => m.valor),
      pacotes_ligados: proposta.pacotes_ligar.map((p) => p.valor),
      pacotes_desligados: proposta.pacotes_desligar.map((p) => p.valor),
    },
  });

  return {
    ok: true,
    version_id: versionId,
    version_number: versionNumber,
    atualizou_rascunho: atualizouRascunho,
    materiais,
    materiais_com_falha: materiaisComFalha,
  };
}
