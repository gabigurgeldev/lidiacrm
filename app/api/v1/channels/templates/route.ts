/**
 * GET  /api/v1/channels/templates — o espelho local + o CONTRATO derivado de cada um.
 * POST /api/v1/channels/templates — força um sync com a Graph API.
 *
 * O contrato vai derivado no payload, e não guardado no banco, de propósito: guardar
 * o derivado criaria a segunda fonte da verdade que esta fase inteira existe para
 * eliminar. A tela e o montador de envio chamam a MESMA `deriveTemplateContract`.
 *
 * Nenhum campo aqui é "quantidade de parâmetros". O número é consequência dos slots;
 * se algum dia aparecer um campo editável com esse nome, o desenho vazou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { metaSessionForOrg } from "@/lib/channels/meta/session";
import { normalizeRejectedReason } from "@/lib/channels/meta/webhook";
import { recorteDoEspelho } from "@/lib/channels/meta/recorte-do-espelho";
import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";
import { syncTemplates } from "@/lib/channels/meta/template-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Um template pronto para a tela: o que a Meta diz + o contrato derivado. */
export interface TemplateView {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  qualityScore: string | null;
  parameterFormat: string;
  contractHash: string;
  syncedAt: string;
  slots: Array<{
    key: string;
    expects: string;
    onde: string;
  }>;
  /**
   * Texto de cada componente que carrega parâmetro, INTEIRO e uma vez só.
   * Antes a tela mostrava o corpo repetido a cada slot, cada linha destacando o
   * seu e deixando o vizinho cru — correto e ilegível. A UI marca os `{{n}}`.
   */
  previews: Array<{ onde: string; text: string }>;
  /** A definição crua — de onde sai o texto que vai no corpo do envio. */
  components: unknown[];
}

/** Textos com placeholder, achatados (inclui os de dentro de card de carrossel). */
function textPreviews(components: unknown): Array<{ onde: string; text: string }> {
  const out: Array<{ onde: string; text: string }> = [];
  const visita = (lista: unknown, prefixo: string) => {
    if (!Array.isArray(lista)) return;
    for (const c of lista as Array<Record<string, unknown>>) {
      const tipo = String(c.type ?? "").toUpperCase();
      if (Array.isArray(c.cards)) {
        (c.cards as Array<Record<string, unknown>>).forEach((card, i) =>
          visita(card.components, `card ${i + 1} › `),
        );
        continue;
      }
      const texto = typeof c.text === "string" ? c.text : "";
      if (!texto.includes("{{")) continue;
      out.push({ onde: `${prefixo}${tipo === "HEADER" ? "cabeçalho" : "corpo"}`, text: texto });
    }
  };
  visita(components, "");
  return out;
}

type OrgGate =
  | { autorizado: true; orgId: string }
  | { autorizado: false; resposta: NextResponse };

/**
 * LER é `manager`; SINCRONIZAR continua `admin`.
 *
 * A assimetria é deliberada e nasceu de um 403 real: o editor de fluxos é gated
 * em `manager` (migration 0205), e os blocos de envio passaram a oferecer
 * "mandar por modelo aprovado". Com `admin` nos dois verbos, um gerente montando
 * um fluxo via a lista vazia — o mesmo sintoma de "não tenho modelo nenhum" que
 * uma conta cheia deles apresentava antes da rota do parceiro existir.
 *
 * O POST fica onde estava: ele fala com a plataforma, gasta cota e reescreve o
 * espelho da organização inteira.
 */
async function orgOrFail(requestId: string, papel: "admin" | "manager" = "admin"): Promise<OrgGate> {
  const authz = await requireRole(papel, { requestId, resource: "channels_templates" });
  if (!authz.ok) return { autorizado: false, resposta: authz.response };
  return { autorizado: true, orgId: authz.org.orgId };
}

/**
 * A WABA de uma conexão, quando ela tem uma.
 *
 * `organization_id` no filtro À MÃO: o cliente admin passa por cima da RLS, e
 * um `canal_id` copiado de outro tenant devolveria a WABA dele — e, com ela, a
 * lista de definições de outra empresa. O id vem da query; a organização, do
 * cookie validado.
 *
 * Tolerante à coluna ausente pelo mesmo motivo do resto do repo: `meta_waba_id`
 * nasceu na 0087, e um clone que suba o código antes do schema perderia a lista
 * inteira por causa de um 42703 — em vez de cair no recorte de queda.
 */
async function wabaDaConexao(orgId: string, canalId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_sessions")
    .select("meta_waba_id")
    .eq("id", canalId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const waba = (data as { meta_waba_id?: string | null } | null)?.meta_waba_id;
  return waba !== null && waba !== undefined && waba !== "" ? waba : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const r = await orgOrFail(requestId, "manager");
  if (!r.autorizado) return r.resposta;

  const canalBruto = req.nextUrl.searchParams.get("canal_id");
  const canalId = canalBruto === null || canalBruto.trim() === "" ? null : canalBruto.trim();

  const sessao = await metaSessionForOrg(r.orgId);
  const admin = createAdminClient();
  const consulta = admin
    .from("meta_templates")
    .select(
      "name, language, status, category, rejected_reason, quality_score, parameter_format, contract_hash, components, synced_at",
    )
    .eq("organization_id", r.orgId);
  // ⚠️ FILTRA PELA WABA QUE ESTA TELA SINCRONIZA.
  //
  // Desde que a organização passou a poder ter mais de um número oficial, ela
  // pode ter mais de uma WABA — e o espelho `meta_templates` é chaveado por
  // `(org, waba, nome, idioma)`. Sem este filtro a lista misturava as definições
  // de todas as WABAs, enquanto o botão de sincronizar puxava as de UMA só
  // (`metaSessionForOrg` devolve a mais antiga). O operador via um template,
  // mandava sincronizar, e ele não atualizava nunca — sem nada na tela explicando
  // por quê. Listar exatamente o que se sincroniza é o mínimo para a tela não
  // mentir.
  //
  // O caso comum não muda: vários números sob a MESMA WABA compartilham os
  // mesmos templates, que é como a Meta modela isso.
  // ⚠️ O RECORTE DE `canal_id` É PELA WABA DA CONEXÃO, NUNCA POR
  // `channel_session_id` — e essa distinção já custou a lista inteira.
  //
  // A primeira versão deste filtro fazia `.eq("channel_session_id", canalId)`,
  // que é o que o nome da coluna sugere. Só que `template-sync.ts` — o caminho
  // que espelha as definições do canal oficial — NÃO grava essa coluna: ele
  // chaveia por `(organization_id, waba_id, name, language)` e deixa
  // `channel_session_id` nulo (a 0154 chama isso de "estado legítimo": as
  // linhas vieram da WABA e ninguém sabe de qual número são).
  //
  // Resultado medido: escolher o número no bloco de fluxo devolvia ZERO linhas
  // para toda organização do canal oficial, e a tela dizia "nenhum modelo
  // aprovado" com o espelho cheio. O filtro mais específico era o mais errado.
  //
  // Pela WABA é também o modelo REAL da plataforma: template é aprovado por
  // conta, e todos os números daquela conta compartilham os mesmos. O que este
  // parâmetro conserta é outra coisa — a lista deixa de ser sempre a da conexão
  // oficial MAIS ANTIGA (`metaSessionForOrg`) e passa a ser a da conexão que o
  // operador escolheu, que é o ponto de uma organização com duas contas.
  //
  // `channel_session_id` continua valendo como recorte de queda para as linhas
  // que o TÊM (as que a rota do parceiro espelha, que sempre o gravam).
  const recorte = recorteDoEspelho({
    canalId,
    wabaDoCanal: canalId === null ? null : await wabaDaConexao(r.orgId, canalId),
    wabaDaSessao: sessao?.wabaId ?? null,
  });
  const escopada = recorte === null ? consulta : consulta.eq(recorte.coluna, recorte.valor);

  const { data, error } = await escopada.order("status").order("name");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const templates: TemplateView[] = (data ?? []).map((row) => {
    const contrato = deriveTemplateContract({
      name: row.name,
      language: row.language,
      parameter_format: row.parameter_format,
      components: row.components as never,
    });
    return {
      name: row.name,
      language: row.language,
      status: row.status,
      category: row.category,
      // Normaliza na LEITURA também: o "NONE" da Meta pode ter sido gravado por
      // uma versão anterior ao conserto, e um clone atualizado ainda o carrega.
      rejectedReason: normalizeRejectedReason(row.rejected_reason),
      qualityScore: row.quality_score,
      parameterFormat: contrato.parameterFormat,
      contractHash: row.contract_hash,
      syncedAt: row.synced_at,
      slots: contrato.slots.map((s) => ({
        key: s.key,
        expects: s.expects,
        onde: describeAddress(s.address),
      })),
      previews: textPreviews(row.components),
      // A DEFINIÇÃO crua, como a rota do canal intermediado já devolve.
      //
      // `previews` não serve para isto: ele filtra por `{{` (só interessa
      // mostrar o que tem variável), então um modelo SEM variável sai com a
      // lista vazia — e são exatamente esses que o operador consegue disparar
      // sem preencher nada. O seletor da janela fechada monta o corpo da
      // mensagem a partir daqui; sem o campo, ele caía no NOME TÉCNICO do
      // modelo e era isso que o cliente recebia.
      components: (row.components as unknown[]) ?? [],
    };
  });

  return ok({
    // `null` aqui não é "erro": é o estado de quem não tem canal oficial ATIVO —
    // nunca conectou, ou conectou e excluiu —, e a tela precisa distingui-lo de
    // "conectado, porém sem template".
    waba: sessao?.wabaId ?? null,
    templates,
  });
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const r = await orgOrFail(requestId, "admin");
  if (!r.autorizado) return r.resposta;

  const sessao = await metaSessionForOrg(r.orgId);
  if (!sessao?.wabaId) {
    return fail("invalid_request", "no_meta_channel", 400, { requestId });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN ?? "";
  if (!token) return fail("invalid_request", "missing_meta_token", 400, { requestId });

  try {
    const counts = await syncTemplates({
      organizationId: r.orgId,
      wabaId: sessao.wabaId,
      token,
      graphVersion: process.env.META_GRAPH_VERSION ?? "v22.0",
    });
    return ok(counts);
  } catch (err) {
    // A falha da Graph API vira mensagem legível na tela, não 500 mudo — o
    // operador precisa saber se é token vencido, WABA errada ou rede.
    return fail("internal_error", err instanceof Error ? err.message : "sync_failed", 502, {
      requestId,
    });
  }
}
