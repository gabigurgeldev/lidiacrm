/**
 * O ENVIO DE UM DESTINATÁRIO — compartilhado pelos DOIS relógios.
 *
 * ═══ Por que existe separado ═══
 *
 * O disparo roda em dois lugares: o cron dedicado
 * (`app/api/v1/cron/bulk-send-worker`), que o contêiner `scheduler` chama numa
 * VPS, e a tarefa `bulk-send-worker` do relógio HTTP
 * (`lib/relogio/executar.ts`), que é o caminho de quem NÃO tem o contêiner —
 * GitHub Actions, cron-job.org, o botão na tela. Os dois precisam do mesmo
 * envio, e uma segunda cópia deste arquivo é uma cópia que diverge no dia em
 * que um dos dois for consertado.
 *
 * ═══ Por que passa pelo `sendMessageHandler` ═══
 *
 * Porque ele é o ponto ÚNICO de saída do sistema — UI, agente de IA, automação
 * e MCP passam por lá. É onde moram o veto de `is_blocked`, o pré-voo do
 * contrato de template (`conferirDefinicao`), a resolução de endereço por
 * canal, o registro em `messages`, a auditoria `message.sent` e o
 * `emit_event`. Um caminho de saída próprio para o disparo nasceria sem tudo
 * isso, e — pior — sem herdar o próximo conserto que o ponto único receber.
 *
 * ═══ Devolve a LINHA da mensagem, nunca um booleano ═══
 *
 * `sendMessageHandler` não lança quando o envio falha: marca `messages.status`
 * e devolve. Quem decide o desfecho é `desfechoDoEnvio`, no motor, lendo esse
 * status. Um `Promise<boolean>` aqui apagaria a diferença entre `sent`,
 * `queued` e `failed` — e as três levam a comportamentos distintos.
 */
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ensureConversation } from "@/lib/automation/start-conversation";
import type { MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import type { DestinatarioPendente, DisparoEmVoo } from "@/lib/bulk-send/motor";
import { createAdminClient } from "@/lib/supabase/admin";

export async function enviarUmDoDisparo(
  disparo: DisparoEmVoo,
  destinatario: DestinatarioPendente,
): Promise<MensagemEnviada> {
  const admin = createAdminClient();

  // Acha, reabre ou cria a conversa 1:1 do contato naquele número. Reabrir é o
  // comportamento certo: a conversa É o thread com aquela pessoa naquele
  // número, e o índice único não tem filtro de status.
  const conversationId = await ensureConversation(
    admin,
    disparo.organization_id,
    destinatario.contact_id,
    disparo.channel_session_id,
  );

  const entrada =
    disparo.mode === "template"
      ? {
          conversation_id: conversationId,
          type: "template",
          template_name: disparo.template_name,
          template_language: disparo.template_language,
          template_values: disparo.template_values,
        }
      : { conversation_id: conversationId, type: "text", body: disparo.body ?? "" };

  const mensagem = await sendMessageHandler(
    admin,
    {
      organization_id: disparo.organization_id,
      // Mesmo molde de `lib/automation/actions/send-whatsapp.ts`: o ator é a
      // peça que pediu o envio, e o requestId correlaciona no audit log a
      // trilha inteira deste disparo.
      actor: { type: "webhook_source", id: `bulk_send:${disparo.id}` },
      requestId: `bulk_send:${disparo.id}`,
    },
    entrada as Parameters<typeof sendMessageHandler>[2],
  );

  return mensagem as unknown as MensagemEnviada;
}
