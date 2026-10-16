/**
 * Quem atende quando falta informação — o modo de fallback da organização.
 *
 * O agente inventava fato da empresa porque, sem fonte, a única instrução que
 * recebia era "responda com o que você já sabe" ou "diga que vai confirmar" — a
 * primeira é um convite, a segunda uma promessa que nada no sistema cumpre. A
 * saída honesta depende de QUEM existe do outro lado:
 *
 * - `equipe`: há gente atendendo pela Caixa de entrada ⇒ avisar e passar;
 * - `so_agente`: não há ⇒ dizer que não tem a informação, sem prometer retorno.
 *
 * A escolha explícita da organização (`settings.ai.fallback_sem_fonte`) vence.
 * Sem escolha, decide a EQUIPE CONFIGURADA: membros agent+ com disponibilidade
 * cadastrada. Não basta "ter membro": numa instalação fresca o dono é admin e
 * contaria como equipe, e passar a conversa para quem nunca abriu a Caixa de
 * entrada é o mesmo silêncio que este módulo existe para acabar.
 *
 * E mesmo a escolha explícita cede a um fato: se o agente não tem a ferramenta
 * de passagem ligada, `equipe` é impossível de cumprir — o efetivo vira
 * `so_agente`, em vez de mandar o modelo chamar uma ferramenta que não existe.
 */
import type { Queryable } from '../queue/queue';

import { FAIXA_CINZA_PADRAO, orgAiSettingsSchema, type ModoSemFonte } from '@/lib/schemas/settings';

export type OrigemDoModo = 'escolha' | 'equipe_configurada' | 'sem_equipe' | 'sem_ferramenta_de_passagem';

export interface ModoResolvido {
  modo: ModoSemFonte;
  origem: OrigemDoModo;
}

export function resolverModoSemFonte(input: {
  escolhaDaOrg: ModoSemFonte | undefined;
  /** Membros agent+ com disponibilidade cadastrada. */
  equipeConfigurada: number;
  /** A ferramenta `request_human_handoff` está ligada neste agente? */
  handoffDisponivel: boolean;
}): ModoResolvido {
  if (!input.handoffDisponivel) return { modo: 'so_agente', origem: 'sem_ferramenta_de_passagem' };
  if (input.escolhaDaOrg !== undefined) return { modo: input.escolhaDaOrg, origem: 'escolha' };
  return input.equipeConfigurada > 0
    ? { modo: 'equipe', origem: 'equipe_configurada' }
    : { modo: 'so_agente', origem: 'sem_equipe' };
}

export interface AjustesDeFonte {
  /** O que a organização escolheu — `undefined` = não escolheu. */
  escolha: ModoSemFonte | undefined;
  equipeConfigurada: number;
  /** Conferência de fonte antes do envio (gate `grounding`). Ausente = ligada. */
  conferenciaLigada: boolean;
  faixaCinza: number;
}

const PADRAO: AjustesDeFonte = {
  escolha: undefined,
  equipeConfigurada: 0,
  conferenciaLigada: true,
  faixaCinza: FAIXA_CINZA_PADRAO,
};

/**
 * Uma ida ao banco por turno: o jsonb de ajustes e a contagem da equipe.
 *
 * Falha de leitura NÃO derruba o turno e cai no padrão — conferência LIGADA e
 * equipe zero (⇒ `so_agente`). Errar para "não prometer ninguém" é recuperável;
 * prometer uma pessoa que não vem, não.
 */
export async function lerAjustesDeFonte(db: Queryable, organizationId: string): Promise<AjustesDeFonte> {
  try {
    const { rows } = await db.query<{ ai: unknown; equipe: string | number | null }>(
      `select o.settings->'ai' as ai,
              (select count(*)
                 from attendant_availability aa
                 join user_organizations uo
                   on uo.organization_id = aa.organization_id
                  and uo.user_id = aa.user_id
                  and uo.revoked_at is null
                where aa.organization_id = o.id
                  and uo.role in ('agent', 'manager', 'admin')) as equipe
         from organizations o
        where o.id = $1`,
      [organizationId],
    );
    const linha = rows[0];
    if (linha === undefined) return { ...PADRAO };
    const ai = orgAiSettingsSchema.parse(linha.ai ?? {});
    return {
      escolha: ai.fallback_sem_fonte,
      equipeConfigurada: Number(linha.equipe ?? 0),
      conferenciaLigada: ai.grounding_gate !== false,
      faixaCinza: ai.faixa_cinza ?? FAIXA_CINZA_PADRAO,
    };
  } catch {
    return { ...PADRAO };
  }
}
