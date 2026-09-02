/**
 * O tradutor de formato do intermediário de CONTA.
 *
 * ═══ O que este canal tem de diferente dos outros três ═══
 *
 * Um endpoint de envio serve as DUAS modalidades: instância oficial (WABA da
 * Meta) e número ligado por QR compartilham `POST /v1/instances/{id}/messages`,
 * e as credenciais do servidor de cada instância são resolvidas do lado dele. É
 * por isso que aqui não há dois caminhos de envio — e é por isso que o adapter
 * não precisa saber qual modalidade está usando.
 *
 * Quem precisa saber é a REGRA DE ENVIO, e ela não mora aqui: mora em
 * `capabilitiesOfSession({ provider, mode })`. Um `if` de modalidade dentro
 * deste arquivo seria a regra de negócio vazando para o tradutor, que é o que a
 * doutrina `restricao-de-canal` proíbe.
 *
 * ═══ `isConfigured` responde `true`, e o motivo está medido ═══
 *
 * A credencial vive na SESSÃO (cifrada no banco), não no ambiente — é o que
 * permite duas organizações terem contas diferentes na mesma instalação.
 * `isConfigured` é síncrono e não pode consultar o banco, então olhar só o env
 * responderia "não configurado" para toda instalação que conectou pela tela.
 *
 * Isso não é teoria: é a dívida escrita em `meta-cloud.ts`, onde `isConfigured`
 * só olha o `.env` e o handler grava `queued` com `queued_reason` para sempre —
 * mensagem parada no inbox, sem erro, com o canal conectado e funcionando.
 *
 * O custo de responder `true` é que `send` precisa ser quem desiste — e ele
 * LANÇA em vez de devolver `{externalId: null}`, porque `null` faria o handler
 * gravar `sent` sem id, dizendo "enviado" para algo que nunca saiu.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

import { resolveStevoCreds } from "../stevo/credentials";
import { corpoDeEnvioStevo, idDaRespostaStevo } from "../stevo/envelope";
import { lerInstanciaStevo } from "../stevo/instancias";

/** E.164 em dígitos, sem `+` e sem sufixo de domínio — é o que o `to` espera. */
function digitos(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

export const stevoAdapter: ChannelAdapter = {
  provider: "stevo",

  /**
   * Telefone em dígitos.
   *
   * Grupo devolve `null`: a API de grupos dele é outro recurso, com id próprio,
   * e fingir que um chatId de grupo cabe no campo `to` mandaria a mensagem para
   * o lugar errado — ou para lugar nenhum, com um 4xx que ninguém interpreta.
   *
   * Ao contrário do outro intermediado, aqui NÃO há fallback para id opaco: este
   * canal endereça por telefone, e um identificador de plataforma no campo `to`
   * não é um destinatário que ele reconheça.
   */
  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;

    const doIdentity = input.waIdentity?.startsWith("phone:")
      ? input.waIdentity.slice("phone:".length)
      : null;
    const bruto = doIdentity ?? input.phoneNumber ?? null;
    if (!bruto) return null;
    const d = digitos(bruto);
    return d.length > 0 ? d : null;
  },

  isConfigured(): boolean {
    // Ver o cabeçalho: `true` de propósito, e quem desiste é `send`.
    return true;
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    if (envelope.kind === "contact") {
      // O contrato de envio não tem campo de vcard. Falhar com nome próprio é
      // melhor que mandar o cartão como texto sem avisar — o operador acha que
      // compartilhou um contato e o cliente recebeu um bloco de `BEGIN:VCARD`.
      throw new Error(
        "stevo_contact_not_supported: envio de cartão de contato não suportado neste canal.",
      );
    }

    const admin = createAdminClient();
    const creds = await resolveStevoCreds(admin, {
      organizationId: envelope.organizationId,
      instanceId: envelope.sessionRef,
    });
    if (!creds) {
      throw new Error(
        "stevo_not_configured: nenhuma credencial para esta instância (nem na sessão, nem no ambiente).",
      );
    }

    const res = await fetch(
      `${creds.baseUrl}/v1/instances/${encodeURIComponent(creds.instanceId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpoDeEnvioStevo(envelope)),
      },
    );

    const json = (await res.json().catch(() => null)) as {
      sent?: boolean;
      engine?: string;
      result?: unknown;
      error?: string;
      message?: string;
    } | null;

    // `sent: false` com HTTP 2xx é um desfecho real deste contrato: a chamada
    // chegou, o motor recusou. Tratar só o status HTTP diria "enviado" para uma
    // mensagem que o provedor acabou de recusar.
    if (!res.ok || json?.sent === false) {
      const detalhe = json?.error ?? json?.message ?? res.statusText;
      throw new Error(`stevo_send_failed: ${res.status} ${detalhe}`.trim());
    }

    // `null` aqui NÃO é falha: é "saiu e não consigo casar o eco do webhook com
    // esta linha". Ver `../stevo/envelope.ts`.
    return { externalId: idDaRespostaStevo(json?.result ?? json) };
  },

  /**
   * A instância está de pé AGORA? Pergunta ao provedor, não ao banco.
   *
   * `reachable: false` não é o mesmo que desconectada: significa que não deu
   * para perguntar. A ação é outra — verificar a rede do servidor, não reparear
   * o número — e sobrescrever o estado com um erro de rede transitório trocaria
   * informação boa por ruído.
   */
  async checkHealth(input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    const admin = createAdminClient();
    const creds = await resolveStevoCreds(admin, {
      organizationId: input.organizationId,
      instanceId: input.sessionRef,
    });
    if (!creds) {
      return { reachable: false, status: null, detail: "sem credencial para esta instância" };
    }

    const instancia = await lerInstanciaStevo({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      instanceId: creds.instanceId,
    });
    if (!instancia) {
      return { reachable: false, status: null, detail: "o provedor não respondeu" };
    }

    return {
      reachable: true,
      // O vocabulário de estado é DELE e é aberto — quem traduz para o nosso é
      // quem consome, não este adapter.
      status: instancia.conectada ? "WORKING" : (instancia.status ?? "STOPPED"),
      detail: instancia.conectada ? null : (instancia.status ?? "instância desconectada"),
    };
  },

  codes: {
    notConfigured: "stevo_not_configured",
    sendFailed: "stevo_send_failed",
    unknownError: "stevo_unknown",
  },
};
