/**
 * O diagnóstico de UMA organização para o agente de suporte (Contrato de
 * Suporte v1, `GET /suporte/v1/contas/{org}/diagnostico`).
 *
 * Responde a pergunta do cliente que escreve "deu erro na minha conta": o que,
 * nesta conta, está quebrado AGORA, dito em português que o agente repete sem
 * traduzir, e qual correção do catálogo resolve.
 *
 * Referências curtas, nunca ids: o canal é "1", "2"… na ordem em que foi
 * criado (o mesmo número volta como parâmetro de `reconectar_canal` e é
 * resolvido de novo AQUI, dentro da organização). Telefone sai mascarado.
 *
 * Toda query filtra `organization_id` — o admin client não passa pela RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { estadoDeAcesso } from "@/lib/billing/acesso";
import { configDeCobranca } from "@/lib/billing/servico";

import { canaisNumerados, mascararTelefone } from "@/lib/channels/canais-numerados";

import type { Diagnostico } from "./contrato";

type Verificacao = Diagnostico["verificacoes"][number];

/** Materiais ativos numerados — referência curta para `reindexar_material`. */
export async function materiaisNumerados(
  admin: SupabaseClient,
  organizationId: string,
): Promise<Array<{ ref: string; id: string; nome: string; status: string | null; trechos: number }>> {
  const { data } = await admin
    .from("ai_knowledge_sources")
    .select("id, name, last_index_status, chunks_count, created_at")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  return ((data ?? []) as Array<{ id: string; name: string; last_index_status: string | null; chunks_count: number | null }>).map(
    (m, i) => ({ ref: String(i + 1), id: m.id, nome: m.name, status: m.last_index_status, trechos: m.chunks_count ?? 0 }),
  );
}

const STATUS_DO_CANAL: Record<string, { status: Verificacao["status"]; frase: string }> = {
  WORKING: { status: "ok", frase: "conectado e funcionando" },
  STARTING: { status: "atencao", frase: "iniciando — costuma levar alguns segundos" },
  SCAN_QR_CODE: { status: "problema", frase: "desconectado: precisa ler o QR Code de novo no celular" },
  STOPPED: { status: "problema", frase: "parado" },
  FAILED: { status: "problema", frase: "com falha na conexão" },
};

export async function diagnosticar(
  admin: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<Diagnostico> {
  const desde24h = new Date(agora.getTime() - 86_400_000).toISOString();
  const [orgRes, canais, materiais, falhasRes, agentesRes, assinaturaRes, orcamentoRes, gastoRes, avisosRes, pausadasRes] =
    await Promise.all([
      admin
        .from("organizations")
        .select("display_name, legal_name, status, suspended_at")
        .eq("id", organizationId)
        .maybeSingle(),
      canaisNumerados(admin, organizationId),
      materiaisNumerados(admin, organizationId),
      admin
        .from("messages")
        .select("error_code", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("status", "failed")
        .gte("created_at", desde24h)
        .limit(200),
      admin
        .from("ai_agents")
        .select("id, name, is_active, published_version_id")
        .eq("organization_id", organizationId)
        .is("archived_at", null),
      admin
        .from("assinaturas")
        .select("status, isenta, trial_termina_em, pago_ate")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      admin
        .from("ai_budgets")
        .select("monthly_limit_cents, enforcement_mode")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      admin.rpc("fn_gasto_de_ia_do_mes", { p_org: organizationId }),
      admin
        .from("agent_inbox_items")
        .select("kind, severity")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .limit(200),
      admin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gt("bot_silenced_until", agora.toISOString()),
    ]);

  const org = orgRes.data as { display_name: string | null; legal_name: string | null; status: string | null; suspended_at: string | null } | null;
  const v: Verificacao[] = [];

  // ── Conta ──
  if (org?.suspended_at) {
    v.push({
      id: "conta_suspensa",
      area: "conta",
      status: "problema",
      titulo: "A conta está suspensa",
      detalhe: "Com a conta suspensa ninguém consegue usar o sistema. Isso só a equipe resolve.",
    });
  }

  // ── Assinatura ──
  const assinatura = assinaturaRes.data as { status: string; isenta: boolean; trial_termina_em: string | null; pago_ate: string | null } | null;
  if (assinatura) {
    const acesso = estadoDeAcesso(assinatura, configDeCobranca(), agora);
    if (!acesso.liberado) {
      v.push({
        id: "assinatura",
        area: "assinatura",
        status: "problema",
        titulo: acesso.motivo === "trial_vencido" ? "O período de teste acabou" : "A assinatura está com pagamento pendente",
        detalhe: "Enquanto não for regularizada, o acesso ao sistema fica bloqueado. Pagamento é com a equipe.",
      });
    } else if (acesso.emAviso) {
      v.push({
        id: "assinatura",
        area: "assinatura",
        status: "atencao",
        titulo: `A assinatura vence em ${acesso.diasRestantes ?? 0} dia(s)`,
        detalhe: "Ainda está tudo funcionando.",
      });
    }
  }

  // ── WhatsApp ──
  if (canais.length === 0) {
    v.push({
      id: "whatsapp_nenhum",
      area: "whatsapp",
      status: "atencao",
      titulo: "Nenhum número de WhatsApp conectado",
      detalhe: "Sem número conectado, o sistema não recebe nem envia mensagens. Conecte em Conexões.",
    });
  }
  for (const c of canais) {
    const s = STATUS_DO_CANAL[c.status ?? ""] ?? { status: "atencao" as const, frase: `em estado ${c.status ?? "desconhecido"}` };
    const nome = `${c.nome ? `"${c.nome}" ` : ""}(${mascararTelefone(c.telefone)})`;
    const podeReconectar = s.status === "problema" && c.temSessao && c.status !== "SCAN_QR_CODE";
    v.push({
      id: `whatsapp_${c.ref}`,
      area: "whatsapp",
      status: s.status,
      titulo: `Canal ${c.ref} ${nome}: ${s.frase}`,
      detalhe:
        c.status === "SCAN_QR_CODE"
          ? "Reconectar não resolve: é preciso abrir Conexões no sistema e ler o QR Code com o celular desse número."
          : podeReconectar
            ? "Reiniciar a sessão costuma resolver sem precisar ler o QR Code de novo."
            : "",
      ...(podeReconectar ? { acao_sugerida: { acao: "reconectar_canal", params: { canal: c.ref } } } : {}),
    });
  }

  const falhas = falhasRes.count ?? 0;
  if (falhas > 0) {
    v.push({
      id: "mensagens_com_falha",
      area: "whatsapp",
      status: falhas >= 10 ? "problema" : "atencao",
      titulo: `${falhas} mensagem(ns) não saíram nas últimas 24 horas`,
      detalhe: "Mensagens que falharam não são reenviadas automaticamente — reenviar em dobro é pior que não enviar.",
    });
  }

  // ── Agentes de IA ──
  const agentes = (agentesRes.data ?? []) as Array<{ name: string; is_active: boolean; published_version_id: string | null }>;
  const semPublicar = agentes.filter((a) => a.is_active && !a.published_version_id);
  if (agentes.length > 0 && agentes.every((a) => !a.is_active || !a.published_version_id)) {
    v.push({
      id: "agente_parado",
      area: "ia",
      status: "problema",
      titulo: "Nenhum agente de IA publicado e ativo",
      detalhe: "Sem agente publicado, ninguém responde automaticamente. Publique uma versão em Central de IA › Agentes.",
    });
  } else if (semPublicar.length > 0) {
    v.push({
      id: "agente_sem_versao",
      area: "ia",
      status: "atencao",
      titulo: `Agente sem versão publicada: ${semPublicar.map((a) => a.name).join(", ")}`,
      detalhe: "Edições só valem depois de publicar.",
    });
  }

  // ── Orçamento de IA ──
  const orcamento = orcamentoRes.data as { monthly_limit_cents: number | null; enforcement_mode: string | null } | null;
  const gasto = typeof gastoRes.data === "number" ? gastoRes.data : Number(gastoRes.data ?? 0);
  if (orcamento?.monthly_limit_cents && orcamento.monthly_limit_cents > 0 && orcamento.enforcement_mode !== "off") {
    const pct = Math.round((gasto / orcamento.monthly_limit_cents) * 100);
    if (pct >= 100) {
      v.push({
        id: "orcamento_ia",
        area: "ia",
        status: orcamento.enforcement_mode === "bloquear" ? "problema" : "atencao",
        titulo: `O gasto de IA do mês chegou a ${pct}% do teto`,
        detalhe:
          orcamento.enforcement_mode === "bloquear"
            ? "Com o teto atingido, a IA para de responder até o mês virar ou o teto subir (Central de IA › Uso e orçamento)."
            : "A IA continua respondendo; o teto é só aviso.",
      });
    } else if (pct >= 80) {
      v.push({ id: "orcamento_ia", area: "ia", status: "atencao", titulo: `O gasto de IA do mês está em ${pct}% do teto`, detalhe: "" });
    }
  }

  // ── Base de conhecimento ──
  for (const m of materiais.filter((x) => x.status === "failed")) {
    v.push({
      id: `material_${m.ref}`,
      area: "conhecimento",
      status: "problema",
      titulo: `O material "${m.nome}" não entrou na base de conhecimento`,
      detalhe: "O agente não consegue consultar este material. Processar de novo costuma resolver.",
      acao_sugerida: { acao: "reindexar_material", params: { material: m.ref } },
    });
  }

  // ── Conversas pausadas para o robô ──
  const pausadas = pausadasRes.count ?? 0;
  if (pausadas > 0) {
    v.push({
      id: "conversas_pausadas",
      area: "atendimento",
      status: "atencao",
      titulo: `${pausadas} conversa(s) com o robô pausado`,
      detalhe: "Nessas conversas quem responde é a equipe; o agente só volta quando alguém devolver a conversa a ele.",
    });
  }

  // ── Avisos abertos na Central ──
  const criticos = ((avisosRes.data ?? []) as Array<{ severity: string }>).filter((a) => a.severity === "critical").length;
  if (criticos > 0) {
    v.push({
      id: "avisos_criticos",
      area: "conta",
      status: "atencao",
      titulo: `${criticos} aviso(s) crítico(s) abertos na Central de IA › Alertas`,
      detalhe: "Vale abrir a Central e ver cada um.",
    });
  }

  if (v.every((x) => x.status === "ok")) {
    v.push({ id: "tudo_ok", area: "conta", status: "ok", titulo: "Nada fora do normal nesta conta agora", detalhe: "" });
  }

  return {
    conta: {
      nome: org?.display_name ?? org?.legal_name ?? "Conta",
      status: org?.suspended_at ? "suspensa" : (org?.status ?? "ativa"),
    },
    verificacoes: v.slice(0, 50),
    gerado_em: agora.toISOString(),
  };
}
