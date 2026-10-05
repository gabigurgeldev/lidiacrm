/**
 * Integrações via API do lado das ROTAS (supabase-js, service role).
 *
 * As rotas autorizam com `requireRole` e resolvem a organização do cookie; o
 * que fica aqui é leitura e escrita com o filtro `organization_id` explícito —
 * o admin client não passa pela RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { chamarEndpoint, type RespostaDaChamada } from "@/lib/ai/integracoes/cliente-http";
import { montarRequisicao } from "@/lib/ai/integracoes/caminho";
import type { AuthTipo, Metodo, ModoDeEndpoint } from "@/lib/ai/integracoes/schema";
import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";
import { CAMINHOS, CatalogoSchema, SaudeSchema, type Catalogo } from "@/lib/suporte/contrato";

export const COLUNAS_DA_INTEGRACAO =
  "id, organization_id, nome, descricao, tipo, base_url, auth_tipo, auth_header_nome, segredo_last4, identidade_modo, identidade_endpoint_id, sessao_horas, ativo, arquivada_em, ultimo_teste_em, ultimo_teste_ok, ultimo_teste_erro, falhas_consecutivas, circuito_aberto_ate, created_at, updated_at";

export const COLUNAS_DO_ENDPOINT =
  "id, organization_id, integration_id, slug, titulo, descricao_para_ia, metodo, caminho, parametros, corpo_fixo, modo, exige_identidade, texto_de_confirmacao, campos_da_resposta, timeout_ms, ativo, origem, created_at, updated_at";

export type IntegracaoRow = {
  id: string;
  organization_id: string;
  nome: string;
  descricao: string | null;
  tipo: "generica" | "suporte_v1";
  base_url: string;
  auth_tipo: AuthTipo;
  auth_header_nome: string | null;
  segredo_last4: string | null;
  identidade_modo: "nenhuma" | "email_otp";
  identidade_endpoint_id: string | null;
  sessao_horas: number;
  ativo: boolean;
  arquivada_em: string | null;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_erro: string | null;
  falhas_consecutivas: number;
  circuito_aberto_ate: string | null;
  created_at: string;
  updated_at: string;
};

export type EndpointRow = {
  id: string;
  organization_id: string;
  integration_id: string;
  slug: string;
  titulo: string;
  descricao_para_ia: string;
  metodo: Metodo;
  caminho: string;
  parametros: unknown;
  corpo_fixo: Record<string, unknown> | null;
  modo: ModoDeEndpoint;
  exige_identidade: boolean;
  texto_de_confirmacao: string | null;
  campos_da_resposta: string[];
  timeout_ms: number;
  ativo: boolean;
  origem: "manual" | "catalogo_suporte_v1";
  created_at: string;
  updated_at: string;
};

export async function carregarIntegracao(
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<IntegracaoRow | null> {
  const { data } = await admin
    .from("ai_api_integrations")
    .select(COLUNAS_DA_INTEGRACAO)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  return (data as IntegracaoRow | null) ?? null;
}

export async function carregarEndpoint(
  admin: SupabaseClient,
  organizationId: string,
  integrationId: string,
  id: string,
): Promise<EndpointRow | null> {
  const { data } = await admin
    .from("ai_api_endpoints")
    .select(COLUNAS_DO_ENDPOINT)
    .eq("organization_id", organizationId)
    .eq("integration_id", integrationId)
    .eq("id", id)
    .maybeSingle();
  return (data as EndpointRow | null) ?? null;
}

export async function gravarSegredo(
  admin: SupabaseClient,
  organizationId: string,
  integrationId: string,
  segredo: string,
): Promise<{ ok: true; last4: string } | { ok: false; erro: string }> {
  const c = encryptKey(segredo);
  const { error } = await admin.from("ai_api_integration_secrets").upsert(
    {
      integration_id: integrationId,
      organization_id: organizationId,
      segredo_encrypted: bufToBytea(c.ciphertext),
      segredo_iv: bufToBytea(c.iv),
      segredo_tag: bufToBytea(c.tag),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id" },
  );
  if (error) return { ok: false, erro: error.message };
  await admin
    .from("ai_api_integrations")
    .update({ segredo_last4: c.last4, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", integrationId);
  return { ok: true, last4: c.last4 };
}

export async function lerSegredo(
  admin: SupabaseClient,
  organizationId: string,
  integrationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("ai_api_integration_secrets")
    .select("segredo_encrypted, segredo_iv, segredo_tag")
    .eq("organization_id", organizationId)
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (!data) return null;
  try {
    return decryptKey({
      ciphertext: byteaToBuffer(data.segredo_encrypted),
      iv: byteaToBuffer(data.segredo_iv),
      tag: byteaToBuffer(data.segredo_tag),
    });
  } catch {
    return null;
  }
}

export async function registrarChamadaDeTeste(
  admin: SupabaseClient,
  organizationId: string,
  input: { integrationId: string; endpointId: string | null; origem: "teste" | "importacao"; resposta: RespostaDaChamada },
): Promise<void> {
  const r = input.resposta;
  await admin.from("ai_api_chamadas").insert({
    organization_id: organizationId,
    integration_id: input.integrationId,
    endpoint_id: input.endpointId,
    origem: input.origem,
    http_status: r.http_status,
    ok: r.ok,
    erro_codigo: r.erro_codigo,
    duracao_ms: r.duracao_ms,
    bytes_resposta: r.bytes_resposta,
  });
}

/** Testes por minuto, por organização — o "Testar" chama rede de verdade. */
export const TESTES_POR_MINUTO = 20;

export async function testesNoUltimoMinuto(admin: SupabaseClient, organizationId: string): Promise<number> {
  const { count } = await admin
    .from("ai_api_chamadas")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("origem", ["teste", "importacao"])
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  return count ?? 0;
}

/**
 * "Testar conexão": no contrato de suporte, `GET /saude`; numa API genérica,
 * um GET na base — qualquer resposta HTTP que não seja erro de rede ou 5xx
 * prova que o endereço é alcançável (um 404 na raiz é normal).
 */
export async function testarConexao(
  integracao: IntegracaoRow,
  segredo: string | null,
): Promise<{ ok: boolean; resposta: RespostaDaChamada; mensagem: string }> {
  const suporte = integracao.tipo === "suporte_v1";
  const url = suporte ? `${integracao.base_url}${CAMINHOS.saude}` : integracao.base_url;
  const resposta = await chamarEndpoint({
    metodo: "GET",
    url,
    corpo: null,
    auth: { auth_tipo: integracao.auth_tipo, auth_header_nome: integracao.auth_header_nome },
    segredo,
    timeoutMs: 8000,
  });
  if (suporte) {
    const saude = SaudeSchema.safeParse(resposta.dados);
    const ok = resposta.ok && saude.success;
    return {
      ok,
      resposta,
      mensagem: ok
        ? `Conectado a ${saude.data.sistema} (contrato v${saude.data.versao_contrato}).`
        : resposta.ok
          ? "O endereço respondeu, mas não fala o Contrato de Suporte v1."
          : "",
    };
  }
  const alcancavel = resposta.http_status !== null && resposta.http_status < 500;
  return { ok: alcancavel, resposta, mensagem: alcancavel ? `O sistema respondeu (HTTP ${resposta.http_status}).` : "" };
}

export async function buscarCatalogo(
  integracao: IntegracaoRow,
  segredo: string | null,
): Promise<{ ok: true; catalogo: Catalogo; resposta: RespostaDaChamada } | { ok: false; resposta: RespostaDaChamada; erro: string }> {
  const resposta = await chamarEndpoint({
    metodo: "GET",
    url: `${integracao.base_url}${CAMINHOS.catalogo}`,
    corpo: null,
    auth: { auth_tipo: integracao.auth_tipo, auth_header_nome: integracao.auth_header_nome },
    segredo,
    timeoutMs: 10000,
  });
  if (!resposta.ok) return { ok: false, resposta, erro: resposta.erro_codigo ?? "falhou" };
  const parsed = CatalogoSchema.safeParse(resposta.dados);
  if (!parsed.success) return { ok: false, resposta, erro: "catalogo_invalido" };
  return { ok: true, catalogo: parsed.data, resposta };
}

/**
 * Converte o catálogo do contrato em linhas de `ai_api_endpoints`. A busca de
 * identidade e o diagnóstico são fixos do contrato; o resto vem do sistema.
 */
export function endpointsDoCatalogo(catalogo: Catalogo): Array<Omit<EndpointRow, "id" | "organization_id" | "integration_id" | "created_at" | "updated_at" | "ativo">> {
  const out: Array<Omit<EndpointRow, "id" | "organization_id" | "integration_id" | "created_at" | "updated_at" | "ativo">> = [
    {
      slug: "buscar_conta",
      titulo: "Buscar conta pelo e-mail",
      descricao_para_ia: "Usado pela verificação de identidade.",
      metodo: "POST",
      caminho: CAMINHOS.buscarIdentidade,
      parametros: [{ nome: "email", tipo: "string", obrigatorio: true, descricao: "e-mail da conta", onde: "body" }],
      corpo_fixo: null,
      modo: "identidade",
      exige_identidade: false,
      texto_de_confirmacao: null,
      campos_da_resposta: [],
      timeout_ms: 8000,
      origem: "catalogo_suporte_v1",
    },
    {
      slug: "diagnostico",
      titulo: "Diagnóstico da conta",
      descricao_para_ia: `Diagnóstico da conta do cliente em ${catalogo.sistema}: o que está ok, o que precisa de atenção e qual correção é sugerida.`,
      metodo: "GET",
      caminho: CAMINHOS.diagnostico,
      parametros: [],
      corpo_fixo: null,
      modo: "leitura",
      exige_identidade: true,
      texto_de_confirmacao: null,
      campos_da_resposta: [],
      timeout_ms: 10000,
      origem: "catalogo_suporte_v1",
    },
  ];
  for (const l of catalogo.leituras) {
    if (l.slug === "diagnostico" || l.slug === "buscar_conta") continue;
    out.push({
      slug: l.slug,
      titulo: l.titulo,
      descricao_para_ia: l.descricao,
      metodo: l.metodo,
      caminho: l.caminho,
      parametros: l.parametros,
      corpo_fixo: null,
      modo: "leitura",
      exige_identidade: l.caminho.includes("{{conta."),
      texto_de_confirmacao: null,
      campos_da_resposta: l.campos_da_resposta ?? [],
      timeout_ms: 10000,
      origem: "catalogo_suporte_v1",
    });
  }
  for (const a of catalogo.acoes) {
    out.push({
      slug: a.slug,
      titulo: a.titulo,
      descricao_para_ia: a.descricao,
      metodo: "POST",
      caminho: CAMINHOS.acao(a.slug),
      parametros: a.parametros.map((p) => ({ ...p, onde: "body" as const })),
      corpo_fixo: null,
      modo: "acao",
      exige_identidade: true,
      texto_de_confirmacao: a.confirmacao,
      campos_da_resposta: [],
      timeout_ms: 15000,
      origem: "catalogo_suporte_v1",
    });
  }
  return out;
}

/** Monta e chama um endpoint para o botão "Testar" (sem sessão de cliente). */
export async function testarEndpoint(input: {
  integracao: IntegracaoRow;
  endpoint: EndpointRow;
  segredo: string | null;
  valores: Record<string, string | number | boolean>;
  contaDeTeste: { id: string; email: string } | null;
}): Promise<{ ok: false; montagem: string } | { ok: true; resposta: RespostaDaChamada }> {
  const montada = montarRequisicao({
    baseUrl: input.integracao.base_url,
    endpoint: input.endpoint,
    valores: input.valores,
    sessao: input.contaDeTeste ? { contaId: input.contaDeTeste.id, contaEmail: input.contaDeTeste.email } : null,
  });
  if (!montada.ok) return { ok: false, montagem: montada.erro };
  const resposta = await chamarEndpoint({
    metodo: montada.requisicao.metodo,
    url: montada.requisicao.url,
    corpo: montada.requisicao.corpo,
    auth: { auth_tipo: input.integracao.auth_tipo, auth_header_nome: input.integracao.auth_header_nome },
    segredo: input.segredo,
    timeoutMs: input.endpoint.timeout_ms,
    emailVerificado: input.contaDeTeste?.email ?? null,
  });
  return { ok: true, resposta };
}
