/**
 * A política EFETIVA de uma conversa.
 *
 * Precedência (ADR 0002 §Política): se o número tem política própria, ela vale
 * INTEIRA para aquele número; senão vale a da organização. Não há mescla campo
 * a campo — uma política de número é uma política completa, e a tela a
 * apresenta assim ("este número segue regras próprias"). Mesclar destinos de
 * duas versões tornaria impossível responder "qual versão decidiu isto?", que
 * é a pergunta que o diário de transições precisa responder.
 *
 * Cada destino volta com `elegivel`: agente com versão PUBLICADA e não
 * arquivado; fluxo `active` com versão ativa. O pré-filtro do decisor e a
 * revalidação antes de despachar usam este campo — um destino em rascunho (o
 * agente que o construtor acabou de criar) existe na política e não recebe
 * conversa até alguém publicá-lo.
 */
import type { Consulta } from "../banco";
import {
  configDaPoliticaSchema,
  type ConfigDaPolitica,
  type ModoDoCoordenador,
} from "./schema";

export interface DestinoEfetivo {
  id: string;
  chave: string;
  tipo: "agente" | "fluxo";
  agent_id: string | null;
  flow_id: string | null;
  nome: string;
  quando_usar: string;
  exemplos: string[];
  nao_usar: string[];
  prioridade: number;
  permite_conduzir: boolean;
  permite_tarefa: boolean;
  /** Pode receber conversa agora (publicado/ativo e não arquivado). */
  elegivel: boolean;
  /** Versão publicada do agente (para registrar quem conduziu). */
  agent_version_id: string | null;
  /** Versão ativa do fluxo. */
  flow_version_id: string | null;
}

export interface PoliticaEfetiva {
  versao_id: string;
  numero: number;
  modo: ModoDoCoordenador;
  /** null = política da organização; preenchido = política própria do número. */
  channel_session_id: string | null;
  config: ConfigDaPolitica;
  destinos: DestinoEfetivo[];
}

interface LinhaVersao {
  id: string;
  numero: number;
  modo: ModoDoCoordenador;
  config: unknown;
  channel_session_id: string | null;
}

export async function carregarPoliticaEfetiva(
  db: Consulta,
  organizationId: string,
  channelSessionId: string | null,
): Promise<PoliticaEfetiva | null> {
  const { rows: versoes } = await db.query<LinhaVersao>(
    `select v.id, v.numero, v.modo, v.config, v.channel_session_id
       from public.coord_politica_ponteiros p
       join public.coord_politica_versoes v
         on v.id = p.versao_id and v.organization_id = p.organization_id
      where p.organization_id = $1
        and (p.channel_session_id = $2 or p.channel_session_id is null)
      order by (p.channel_session_id is null) asc
      limit 1`,
    [organizationId, channelSessionId],
  );
  const v = versoes[0];
  if (!v) return null;

  return { ...montarVersao(v), destinos: await carregarDestinos(db, organizationId, v.id) };
}

/** Uma versão específica (simulação, diagnóstico, "qual versão decidiu"). */
export async function carregarVersaoDaPolitica(
  db: Consulta,
  organizationId: string,
  versaoId: string,
): Promise<PoliticaEfetiva | null> {
  const { rows } = await db.query<LinhaVersao>(
    `select id, numero, modo, config, channel_session_id
       from public.coord_politica_versoes
      where organization_id = $1 and id = $2`,
    [organizationId, versaoId],
  );
  const v = rows[0];
  if (!v) return null;
  return { ...montarVersao(v), destinos: await carregarDestinos(db, organizationId, v.id) };
}

function montarVersao(v: LinhaVersao): Omit<PoliticaEfetiva, "destinos"> {
  // Config gravada passou pelo schema na publicação; reparsear aqui completa
  // defaults que uma versão antiga não tinha (campo novo com default seguro).
  const lido = configDaPoliticaSchema.safeParse(v.config ?? {});
  return {
    versao_id: v.id,
    numero: v.numero,
    modo: v.modo,
    channel_session_id: v.channel_session_id,
    config: lido.success ? lido.data : configDaPoliticaSchema.parse({}),
  };
}

async function carregarDestinos(
  db: Consulta,
  organizationId: string,
  versaoId: string,
): Promise<DestinoEfetivo[]> {
  const { rows } = await db.query<DestinoEfetivo>(
    `select d.id, d.chave, d.tipo, d.agent_id, d.flow_id,
            coalesce(a.name, f.name, d.chave) as nome,
            d.quando_usar, d.exemplos, d.nao_usar, d.prioridade,
            d.permite_conduzir, d.permite_tarefa,
            case
              when d.tipo = 'agente' then
                a.id is not null and a.archived_at is null
                and av.id is not null and av.status = 'published'
              else
                f.id is not null and f.status = 'active' and f.active_version_id is not null
            end as elegivel,
            av.id as agent_version_id,
            f.active_version_id as flow_version_id
       from public.coord_politica_destinos d
       left join public.ai_agents a
         on a.id = d.agent_id and a.organization_id = d.organization_id
       left join public.ai_agent_versions av
         on av.id = a.published_version_id
       left join public.flows f
         on f.id = d.flow_id and f.organization_id = d.organization_id
      where d.organization_id = $1 and d.versao_id = $2
      order by d.prioridade desc, d.chave asc`,
    [organizationId, versaoId],
  );
  return rows.map((r) => ({
    ...r,
    exemplos: r.exemplos ?? [],
    nao_usar: r.nao_usar ?? [],
    elegivel: r.elegivel === true,
  }));
}
