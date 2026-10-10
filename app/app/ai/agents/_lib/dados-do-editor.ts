/**
 * O que o editor de agente precisa para dizer a verdade sobre o ESCOPO — funis,
 * materiais do acervo, integrações e as chaves da instalação.
 *
 * Mora num lugar só porque morava em dois, e os dois divergiram: a página de
 * edição carregava funis e materiais, a de "Novo agente" não. O formulário de
 * criação abria dizendo "Você ainda não cadastrou nenhum material" e "Você ainda
 * não tem nenhum funil" para quem tinha os dois — o estado vazio mentindo na
 * primeira tela que a pessoa vê ao criar um agente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FunilDaResposta } from "@/hooks/pipelines/usePipelines";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { coberturaDoFunil, type EtapaDoMapa } from "@/lib/leads/agent-mapping";

import type { MaterialDoAcervo } from "../[id]/_components/BasesDoAgente";
import type { CoberturaPorFunil } from "../[id]/_components/FunisDoAgente";
import type { IntegracaoDoAcervo } from "../[id]/_components/IntegracoesDoAgente";

/**
 * Os provedores cuja chave veio na INSTALAÇÃO (`.env`), não da tela de
 * Credenciais. Sai de `lerAmbiente`, a mesma leitura que o retrato da instalação
 * usa — uma segunda lista de nomes de variável divergiria no dia em que um
 * provedor novo entrasse.
 */
export function provedoresDaInstalacao(): string[] {
  return Object.entries(lerAmbiente().chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
}

export interface EscopoDoEditor {
  funis: FunilDaResposta[];
  cobertura: CoberturaPorFunil;
  materiais: MaterialDoAcervo[];
  integracoes: IntegracaoDoAcervo[];
}

export async function carregarEscopoDoEditor(supabase: SupabaseClient, orgId: string): Promise<EscopoDoEditor> {
  const [funisRes, acervoRes, integracoesRes, etapasRes] = await Promise.all([
    // Os funis vêm com a página, não por fetch no cliente: a marcação usa
    // "nenhum funil" para dizer algo importante, e uma lista que chega vazia no
    // primeiro render diria isso por engano.
    supabase
      .from("crm_pipelines")
      .select("id, name, slug, description, position, is_default")
      .eq("organization_id", orgId)
      .eq("is_archived", false)
      .order("position"),
    // O acervo vem com a página pelo mesmo motivo.
    supabase
      .from("ai_knowledge_sources")
      .select("id, name, source_type, chunks_count, last_index_status")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    // Integrações via API (0223) com os endpoints, pelo mesmo motivo.
    supabase
      .from("ai_api_integrations")
      .select(
        "id, nome, identidade_modo, identidade_endpoint_id, ultimo_teste_ok, circuito_aberto_ate, endpoints:ai_api_endpoints!ai_api_endpoints_integration_id_fkey(id, slug, titulo, modo, exige_identidade, ativo)",
      )
      .eq("organization_id", orgId)
      .is("arquivada_em", null)
      .eq("ativo", true)
      .order("created_at", { ascending: true }),
    // Quanto de cada funil o assistente sabe percorrer (spec 17 passo 4): a
    // lacuna precisa aparecer no MESMO lugar em que o dono marca o funil.
    supabase
      .from("crm_stages")
      .select("id, name, is_won, is_lost, agent_stage_hint, pipeline_id")
      .eq("organization_id", orgId)
      .eq("is_archived", false),
  ]);

  const funis = (funisRes.data ?? []) as unknown as FunilDaResposta[];
  const etapasPorFunil = new Map<string, EtapaDoMapa[]>();
  for (const e of (etapasRes.data ?? []) as Array<EtapaDoMapa & { pipeline_id: string }>) {
    etapasPorFunil.set(e.pipeline_id, [...(etapasPorFunil.get(e.pipeline_id) ?? []), e]);
  }
  const cobertura: CoberturaPorFunil = {};
  for (const f of funis) {
    const c = coberturaDoFunil(etapasPorFunil.get(f.id) ?? []);
    cobertura[f.id] = { traduzidos: c.traduzidos, total: c.total, mudo: c.mudo };
  }

  return {
    funis,
    cobertura,
    materiais: (acervoRes.data ?? []) as unknown as MaterialDoAcervo[],
    integracoes: (integracoesRes.data ?? []) as unknown as IntegracaoDoAcervo[],
  };
}
