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
import { modoPermitido, temCustoPorMensagem, temRiscoDeBanimento } from "@/lib/bulk-send/modo";
import { pisoDoIntervalo } from "@/lib/bulk-send/ritmo";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels/capabilities";
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
  const colunas = (comArchived: boolean) =>
    `id, provider, status, display_name, phone_number, daily_message_limit${comArchived ? `, ${ARCHIVED_AT}` : ""}`;

  const { data, error } = await queryTolerantToMissingArchived(
    () =>
      supabase
        .from("channel_sessions")
        .select(colunas(true))
        .eq("organization_id", orgId)
        .is(ARCHIVED_AT, null)
        .order("created_at", { ascending: true }),
    () =>
      supabase
        .from("channel_sessions")
        .select(colunas(false))
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true }),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const sessoes = (data ?? []) as unknown as Array<{
    id: string;
    provider: ChannelProvider;
    status: string;
    display_name: string | null;
    phone_number: string | null;
    daily_message_limit: number | null;
  }>;

  // `channel_knobs` é lida com o client admin: a tabela é de configuração do
  // motor e não tem policy para `authenticated`. O `organization_id` vem do
  // cookie validado (`authz.org.orgId`), NUNCA do corpo — a mesma disciplina do
  // worker, e é o que mantém o bypass de RLS honesto.
  const admin = createAdminClient();
  const agora = Date.now();

  const conexoes = await Promise.all(
    sessoes.map(async (s) => {
      const capabilities = capabilitiesOf(s.provider);
      const { knobs, numberActivatedAt } = await configDePacingDoCanal(admin, orgId, s.id);
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
          ? s.daily_message_limit
          : Math.min(capDoWarmup, s.daily_message_limit ?? Number.POSITIVE_INFINITY);

      return {
        id: s.id,
        rotulo: s.display_name || s.phone_number || "Número sem nome",
        telefone: s.phone_number,
        conectada: s.status === "WORKING",
        // Vocabulário de PRODUTO. A tela nunca vê o nome do canal.
        modo: modoPermitido(s.provider),
        piso_ms: pisoMs,
        piso_origem: origem,
        cobra_por_mensagem: temCustoPorMensagem(s.provider),
        risco_de_banimento: temRiscoDeBanimento(s.provider),
        teto_de_hoje: Number.isFinite(tetoDeHoje) ? tetoDeHoje : null,
        em_aquecimento: capDoWarmup !== null,
        janela: { inicio: knobs.windowStartHour, fim: knobs.windowEndHour, fuso: knobs.timezone },
      };
    }),
  );

  return ok(conexoes, { requestId });
}
