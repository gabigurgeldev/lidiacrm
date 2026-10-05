/**
 * O que o agente de suporte pode CORRIGIR numa conta deste CRM — o catálogo
 * fechado do Contrato de Suporte v1.
 *
 * Cada ação chega aqui só depois de: HMAC, reconferência de que o e-mail
 * verificado administra a conta (lib/suporte/rota.ts), e o SIM do cliente, que
 * o CRM do agente conferiu antes de chamar. Todas são idempotentes pela
 * `Idempotency-Key` (24 h, tabela `idempotency_keys`).
 *
 * ═══ O que fica FORA, de propósito ═══
 *
 *   - reenviar mensagem que falhou: envio em dobro é pior que não-envio
 *     (CLAUDE.md, cron recover-stuck-messages);
 *   - reprocessar job morto: mandaria a um cliente uma mensagem velha, fora de
 *     contexto;
 *   - descartar a credencial do WhatsApp (reconexão FORÇADA): irreversível, e
 *     quem decide reescanear o QR é quem está com o celular;
 *   - plano, cobrança, credencial de IA, membros da equipe: decisão de pessoa.
 */
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { canaisNumerados } from "@/lib/channels/canais-numerados";
import { reiniciarSessaoDoCanal } from "@/lib/channels/reconectar";

import type { Catalogo } from "./contrato";
import { materiaisNumerados } from "./diagnostico";
import { erro, type RespostaDeSuporte } from "./rota";

export const SISTEMA = "Gestalt CRM";

export const CATALOGO: Catalogo = {
  sistema: SISTEMA,
  leituras: [],
  acoes: [
    {
      slug: "reconectar_canal",
      titulo: "Reconectar o WhatsApp",
      descricao:
        "Reinicia a sessão de um número de WhatsApp que está parado ou com falha, sem desconectar o celular. Use o número do canal que aparece no diagnóstico. Não resolve quando o diagnóstico pede para ler o QR Code.",
      parametros: [
        { nome: "canal", tipo: "string", obrigatorio: true, descricao: "número do canal no diagnóstico (1, 2, …)", onde: "body", max_len: 3 },
      ],
      confirmacao: "Posso reiniciar a conexão do WhatsApp do canal {{params.canal}}? Ele fica fora por alguns segundos e volta sozinho.",
    },
    {
      slug: "reindexar_material",
      titulo: "Processar de novo um material da base de conhecimento",
      descricao:
        "Manda processar de novo um material que não entrou na base de conhecimento. Use o número do material que aparece no diagnóstico.",
      parametros: [
        { nome: "material", tipo: "string", obrigatorio: true, descricao: "número do material no diagnóstico (1, 2, …)", onde: "body", max_len: 3 },
      ],
      confirmacao: "Posso processar de novo o material {{params.material}} da sua base de conhecimento?",
    },
  ],
};

const CanalSchema = z.object({ canal: z.string().regex(/^\d{1,3}$/) }).strict();
const MaterialSchema = z.object({ material: z.string().regex(/^\d{1,3}$/) }).strict();

type Executor = (admin: SupabaseClient, organizationId: string, params: unknown) => Promise<RespostaDeSuporte>;

const EXECUTORES: Record<string, Executor> = {
  async reconectar_canal(admin, organizationId, params) {
    const p = CanalSchema.safeParse(params);
    if (!p.success) return erro(422, "params_invalidos", "Informe o número do canal (1, 2, …).");
    const canal = (await canaisNumerados(admin, organizationId)).find((c) => c.ref === p.data.canal);
    if (!canal) return erro(404, "canal_nao_encontrado", `Não existe canal ${p.data.canal} nesta conta.`);
    if (canal.status === "WORKING") {
      return erro(409, "acao_nao_aplicavel", `O canal ${canal.ref} já está conectado e funcionando.`);
    }
    if (canal.status === "SCAN_QR_CODE") {
      return erro(409, "acao_nao_aplicavel", "Esse canal precisa ler o QR Code de novo no celular — reiniciar não resolve.");
    }
    const r = await reiniciarSessaoDoCanal(admin, { organizationId, channelSessionId: canal.id });
    if (!r.ok) return erro(r.http === 404 ? 404 : 409, r.codigo, r.mensagem);
    return {
      status: 200,
      body: {
        ok: true,
        resultado: `A conexão do canal ${canal.ref} foi reiniciada. Em alguns segundos ele volta a funcionar; se continuar parado, pode ser preciso ler o QR Code de novo.`,
      },
    };
  },

  async reindexar_material(admin, organizationId, params) {
    const p = MaterialSchema.safeParse(params);
    if (!p.success) return erro(422, "params_invalidos", "Informe o número do material (1, 2, …).");
    const material = (await materiaisNumerados(admin, organizationId)).find((m) => m.ref === p.data.material);
    if (!material) return erro(404, "material_nao_encontrado", `Não existe material ${p.data.material} nesta conta.`);
    const { data: fonte } = await admin
      .from("ai_knowledge_sources")
      .select("id, agent_id, source_type")
      .eq("organization_id", organizationId)
      .eq("id", material.id)
      .maybeSingle();
    if (!fonte) return erro(404, "material_nao_encontrado", "Material não encontrado.");
    await admin
      .from("ai_knowledge_sources")
      .update({ last_index_error: null })
      .eq("organization_id", organizationId)
      .eq("id", material.id);
    // O mesmo evento do botão "Processar de novo" da tela: o indexador consome.
    const { error } = await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: material.id,
      p_payload: {
        knowledge_source_id: material.id,
        agent_id: (fonte as { agent_id: string | null }).agent_id,
        source_type: (fonte as { source_type: string }).source_type,
        triggered_by: "suporte_v1",
      },
      p_organization_id: organizationId,
    } as never);
    if (error) return erro(502, "fila_indisponivel", "Não consegui pedir o processamento agora.");
    return {
      status: 200,
      body: { ok: true, resultado: `O material "${material.nome}" entrou na fila para ser processado de novo. Leva alguns minutos.` },
    };
  },
};

export function acaoExiste(slug: string): boolean {
  return slug in EXECUTORES;
}

/**
 * Executa com idempotência: a mesma chave em 24 h devolve a primeira resposta
 * sem executar de novo. Sem chave, recusa — o contrato exige.
 */
export async function executarAcao(
  admin: SupabaseClient,
  organizationId: string,
  slug: string,
  params: unknown,
  chave: string | null,
): Promise<RespostaDeSuporte> {
  const executor = EXECUTORES[slug];
  if (!executor) return erro(404, "acao_desconhecida", "Ação fora do catálogo.");
  if (!chave || chave.length > 200) return erro(422, "idempotencia_obrigatoria", "Falta o cabeçalho Idempotency-Key.");

  const endpoint = `suporte_v1:acao:${slug}`;
  const { data: cache } = await admin
    .from("idempotency_keys")
    .select("status_code, response_body")
    .eq("organization_id", organizationId)
    .eq("endpoint", endpoint)
    .eq("key", chave)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cache) {
    const c = cache as { status_code: number; response_body: unknown };
    return { status: c.status_code, body: c.response_body };
  }

  const resposta = await executor(admin, organizationId, params);
  const hash = createHash("sha256").update(JSON.stringify(params ?? {})).digest("hex");
  await admin.from("idempotency_keys").insert({
    organization_id: organizationId,
    endpoint,
    key: chave,
    request_hash: `\\x${hash}`,
    status_code: resposta.status,
    response_body: resposta.body as Record<string, unknown>,
  });
  return resposta;
}
