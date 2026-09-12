/**
 * GET /api/v1/bulk-sends/conexoes — as conexões que servem para um disparo, já
 * com o que a tela precisa DECIDIDO aqui.
 *
 * ═══ Por que uma rota própria, e não `useChannelSessions` ═══
 *
 * Duas razões, e as duas importam.
 *
 * 1. **A tela não pode conhecer provider.** `components/` e `app/` são varridos
 *    por `scripts/lint-channels.ts`, e a doutrina de restrição de canal
 *    (invariante 1) proíbe que uma feature nomeie um canal. Se o cliente
 *    recebesse `provider: "..."` e fizesse `if` em cima, a feature inteira
 *    passaria a saber COM QUEM se fala em vez de O QUE o canal permite.
 *
 * 2. **A régua do ritmo não pode ter segunda cópia.** O piso do intervalo sai
 *    de `pisoDoIntervalo` (os mesmos knobs e a mesma capability que o motor
 *    usa), e o teto de hoje sai de `warmupCapFor` — a função que o comentário
 *    dela manda explicitamente não recopiar na UI. Uma conta refeita no cliente
 *    faria a tela prometer um número e o motor aplicar outro.
 *
 * O que sai daqui é vocabulário de PRODUTO: "aceita texto livre" ou "exige
 * modelo aprovado", "no mínimo 6 segundos entre mensagens", "hoje esta conexão
 * manda no máximo 50".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { warmupCapFor } from "@/lib/agent-engine/pacing/engine";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { configDePacingDoCanal } from "@/lib/automation/janela-do-canal";
import { modoPermitidoNaConexao } from "@/lib/bulk-send/modo";
import { pisoDoIntervalo } from "@/lib/bulk-send/ritmo";
import {
  ARCHIVED_AT,
  consultaTolerante,
  queryTolerantToMissingArchived,
} from "@/lib/channels/archived";
import { capabilitiesOfSession, type ChannelProvider } from "@/lib/channels/capabilities";
import { fonteDeTemplates } from "@/lib/channels/templates-fonte";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DIA_MS = 86_400_000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const supabase = await createClient();
  const colunas = (comModo: boolean, comArchived: boolean) =>
    `id, provider, status, display_name, phone_number, daily_message_limit${
      comModo ? ", provider_mode" : ""
    }${comArchived ? `, ${ARCHIVED_AT}` : ""}`;

  // DUAS tolerâncias ANINHADAS: `provider_mode` (0206) por fora, `archived_at`
  // (0106) por dentro. Ao contrário, um clone sem a coluna mais nova perderia
  // junto o filtro de arquivados, e uma conexão excluída voltaria ao seletor de
  // disparo — regressão de verdade para consertar um campo mais novo. Mesmo
  // desenho de `app/api/v1/channel-sessions`.
  const buscar = (comModo: boolean) => () =>
    queryTolerantToMissingArchived(
      () =>
        supabase
          .from("channel_sessions")
          .select(colunas(comModo, true))
          .eq("organization_id", orgId)
          .is(ARCHIVED_AT, null)
          .order("created_at", { ascending: true }),
      () =>
        supabase
          .from("channel_sessions")
          .select(colunas(comModo, false))
          .eq("organization_id", orgId)
          .order("created_at", { ascending: true }),
    );
  const { data, error } = await consultaTolerante("provider_mode", buscar(true), buscar(false));
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const sessoes = (data ?? []) as unknown as Array<{
    id: string;
    provider: ChannelProvider;
    status: string;
    display_name: string | null;
    phone_number: string | null;
    daily_message_limit: number | null;
    provider_mode?: string | null;
  }>;

  // `channel_knobs` é lida com o client admin: a tabela é de configuração do
  // motor e não tem policy para `authenticated`. O `organization_id` vem do
  // cookie validado (`authz.org.orgId`), NUNCA do corpo — a mesma disciplina do
  // worker, e é o que mantém o bypass de RLS honesto.
  const admin = createAdminClient();
  const agora = Date.now();

  const conexoes = await Promise.all(
    sessoes.map(async (session) => {
      // ⚠️ `capabilitiesOfSession`, e não `capabilitiesOf`.
      //
      // Com o provider sozinho, um provider que hospeda as DUAS modalidades cai
      // na linha conservadora de fallback — `requiresTemplates: true` e
      // `minIntervalMs` do lado oficial. Medido na tela: um número ligado por QR
      // naquela conta era anunciado como "Só envia modelo aprovado", e o texto
      // livre que ele aceita ficava sem caminho no seletor de disparo.
      const modo = session.provider_mode ?? null;
      const capabilities = capabilitiesOfSession({ provider: session.provider, mode: modo });
      const { knobs, numberActivatedAt } = await configDePacingDoCanal(admin, orgId, session.id);
      const { pisoMs, origem } = pisoDoIntervalo(knobs, capabilities);

      // A MESMA função do motor. O comentário dela diz, com todas as letras, que
      // uma segunda cópia na UI é a receita para a tela prometer um número e o
      // motor aplicar outro.
      const idadeDias = numberActivatedAt
        ? Math.max(0, Math.floor((agora - numberActivatedAt.getTime()) / DIA_MS))
        : 0;
      const capDoWarmup = warmupCapFor(idadeDias, knobs.warmupDailyCaps);
      const tetoDeHoje =
        capDoWarmup === null
          ? session.daily_message_limit
          : Math.min(capDoWarmup, session.daily_message_limit ?? Number.POSITIVE_INFINITY);

      return {
        id: session.id,
        // `channel_sessions.display_name` é o número/canal, não uma pessoa —
        // outro conceito do rótulo de contato (`lib/contacts/rotulo-do-contato.ts`).
        rotulo: session.display_name || session.phone_number || "Número sem nome",
        telefone: session.phone_number,
        conectada: session.status === "WORKING",
        // Vocabulário de PRODUTO. A tela nunca vê o nome do canal.
        modo: modoPermitidoNaConexao({ provider: session.provider, mode: modo }),
        // ROTULO NEUTRO de onde vêm as definições aprovadas DESTA conexão —
        // "oficial", "parceiro" ou `null`. A tela monta a URL com ele e nunca vê
        // o nome do canal (`scripts/lint-channels.ts` varre `app/` e reprova).
        // Sem este campo, um bloco de fluxo que oferece envio por modelo teria de
        // adivinhar a rota, e adivinhar aqui é oferecer o modelo de uma conta na
        // conversa de outra.
        fonte_de_modelos: fonteDeTemplates(session.provider, modo),
        piso_ms: pisoMs,
        piso_origem: origem,
        cobra_por_mensagem: capabilities.costPerMessage,
        risco_de_banimento: capabilities.banRisk,
        teto_de_hoje: Number.isFinite(tetoDeHoje) ? tetoDeHoje : null,
        em_aquecimento: capDoWarmup !== null,
        janela: { inicio: knobs.windowStartHour, fim: knobs.windowEndHour, fuso: knobs.timezone },
      };
    }),
  );

  return ok(conexoes, { requestId });
}
