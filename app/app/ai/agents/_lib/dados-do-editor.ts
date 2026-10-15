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
import type { HabilidadeDoCatalogo } from "../[id]/_components/HabilidadesDoAgente";
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
  habilidades: HabilidadeDoCatalogo[];
}

interface PonteiroDeSkill {
  name: string;
  version_id: string;
}
interface VersaoDeSkill {
  id: string;
  description: string;
  nichos: string[] | null;
}

/**
 * As skills que um agente desta organização pode ligar (0241): as de plataforma e
 * as da organização, resolvidas pelos ponteiros como o runtime faz (`loadSkills`) —
 * a da organização vence a de plataforma no mesmo nome. Universal é decidido pela
 * versão de PLATAFORMA (`nichos` vazio), nunca pela cópia da organização.
 *
 * Cada consulta escopa a organização por escrito (`.is(null)` para o catálogo,
 * `.eq(orgId)` para o que é dela): a policy de catálogo deixa ler a plataforma, e
 * `fn_user_org_ids()` devolveria as skills de TODAS as organizações do usuário.
 * Falha de leitura vira lista vazia — a seção diz que não há habilidade, e o resto
 * do editor segue.
 */
export async function carregarHabilidades(supabase: SupabaseClient, orgId: string): Promise<HabilidadeDoCatalogo[]> {
  const [plataformaRes, orgRes] = await Promise.all([
    supabase.from("skill_pointers").select("name, version_id").is("organization_id", null),
    supabase.from("skill_pointers").select("name, version_id").eq("organization_id", orgId),
  ]);
  const plataforma = (plataformaRes.data ?? []) as PonteiroDeSkill[];
  const daOrg = (orgRes.data ?? []) as PonteiroDeSkill[];
  const idsPlataforma = plataforma.map((p) => p.version_id);
  const idsOrg = daOrg.map((p) => p.version_id);
  const [versoesPlataforma, versoesOrg] = await Promise.all([
    idsPlataforma.length > 0
      ? supabase.from("skill_versions").select("id, description, nichos").is("organization_id", null).in("id", idsPlataforma)
      : Promise.resolve({ data: [] }),
    idsOrg.length > 0
      ? supabase.from("skill_versions").select("id, description, nichos").eq("organization_id", orgId).in("id", idsOrg)
      : Promise.resolve({ data: [] }),
  ]);
  const versao = new Map<string, VersaoDeSkill>(
    [...((versoesPlataforma.data ?? []) as VersaoDeSkill[]), ...((versoesOrg.data ?? []) as VersaoDeSkill[])].map(
      (v) => [v.id, v],
    ),
  );

  const porNome = new Map<string, HabilidadeDoCatalogo>();
  for (const p of plataforma) {
    const v = versao.get(p.version_id);
    const nichos = v?.nichos ?? [];
    porNome.set(p.name, {
      name: p.name,
      description: v?.description ?? "",
      nichos,
      universal: nichos.length === 0,
      daOrganizacao: false,
    });
  }
  for (const p of daOrg) {
    const v = versao.get(p.version_id);
    const naPlataforma = porNome.get(p.name);
    porNome.set(p.name, {
      name: p.name,
      description: v?.description ?? naPlataforma?.description ?? "",
      nichos: v?.nichos ?? naPlataforma?.nichos ?? [],
      universal: naPlataforma?.universal ?? false,
      daOrganizacao: true,
    });
  }
  return [...porNome.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function carregarEscopoDoEditor(supabase: SupabaseClient, orgId: string): Promise<EscopoDoEditor> {
  const [funisRes, acervoRes, integracoesRes, etapasRes, habilidades] = await Promise.all([
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
    carregarHabilidades(supabase, orgId),
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
    habilidades,
  };
}
