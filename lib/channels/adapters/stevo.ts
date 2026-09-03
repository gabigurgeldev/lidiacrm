/**
 * O tradutor de formato do intermediário de CONTA.
 *
 * ═══ Dois transportes, e por que isso NÃO é regra de negócio vazando ═══
 *
 * Este arquivo já afirmou o contrário — que um endpoint só servia as duas
 * modalidades — e a afirmação era falsa em produção. O proxy de gestão
 * (`POST /v1/instances/{id}/messages`) de fato aceita as duas, mas para uma
 * instância da API Oficial ele responde `409 not_ready` com "Instância da API
 * Oficial sem token — conecte primeiro": a Oficial não tem servidor de
 * instância para ele proxiar. Ela fala com a Meta por um GATEWAY separado, com
 * Bearer de outro token, em formato Cloud API.
 *
 * Medido na conta de produção: `GET /v1/instances/{id}` devolve `token: null` e
 * `server_url: null` para TODA instância oficial e preenchidos para toda SM v2;
 * o `GET /v1/health` do gateway, com o token que o painel exibe, responde 200
 * com o número LIVE e aprovado. A instância estava certa; o destino é que era o
 * errado.
 *
 * A escolha aqui é de TRANSPORTE, e ela é feita pela CREDENCIAL que existe —
 * "tem token de gateway gravado?" — não por um `if` sobre a modalidade. A
 * diferença importa: a REGRA DE ENVIO (janela de 24h × texto livre com risco de
 * banimento) continua fora daqui, em `capabilitiesOfSession({ provider, mode })`,
 * que é o que a doutrina `restricao-de-canal` protege. Um tradutor pode saber
 * para onde manda; o que ele não pode é decidir se pode mandar.
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

import { corpoCloudApi } from "../cloud-api/corpo";
import {
  resolveStevoCreds,
  stevoBaseUrlOficial,
  stevoOfficialToken,
} from "../stevo/credentials";
import { corpoDeEnvioStevo, idDaRespostaStevo } from "../stevo/envelope";
import { lerInstanciaStevo } from "../stevo/instancias";

/** E.164 em dígitos, sem `+` e sem sufixo de domínio — é o que o `to` espera. */
function digitos(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

/**
 * Envio pelo GATEWAY da API Oficial — o caminho que fala com a Meta.
 *
 * Corpo em formato Cloud API **sem `messaging_product`**: o gateway o
 * acrescenta, e mandá-lo aqui é campo duplicado num payload que ele repassa.
 * Por isso o miolo vem de `corpoCloudApi`, compartilhado com o canal oficial
 * direto, e o `to` é montado aqui — é justamente onde os dois destinos diferem.
 *
 * A resposta é o corpo CRU da Meta (`{ messages: [{ id: "wamid.…" }] }`), então
 * o id sai de lá e não da varredura de `idDaRespostaStevo`, que existe para a
 * resposta do proxy.
 */
async function enviarPeloGateway(
  envelope: OutboundEnvelope,
  token: string,
): Promise<{ externalId: string | null }> {
  const res = await fetch(`${stevoBaseUrlOficial()}/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: envelope.to, ...corpoCloudApi(envelope) }),
  });

  const json = (await res.json().catch(() => null)) as {
    messages?: { id?: string }[];
    error?: string;
    message?: string;
    // O erro da Meta vem embrulhado em `meta` quando existe — é ele que carrega
    // o código que diz a AÇÃO (131047 = fora da janela de 24h, use template).
    meta?: { error?: { code?: number; message?: string; error_data?: { details?: string } } };
  } | null;

  if (!res.ok) {
    const daMeta = json?.meta?.error;
    const detalhe =
      daMeta?.error_data?.details ??
      daMeta?.message ??
      json?.message ??
      json?.error ??
      res.statusText;
    const codigo = daMeta?.code !== undefined ? ` (meta ${daMeta.code})` : "";
    throw new Error(`stevo_send_failed: ${res.status} ${detalhe}${codigo}`.trim());
  }

  return { externalId: json?.messages?.[0]?.id ?? null };
}

/**
 * Saúde de um número da API Oficial, perguntada ao gateway.
 *
 * `GET /v1/health` responde o estado do número NA META — `account_mode`,
 * `account_review_status`, `quality_rating` —, que é o que decide se a mensagem
 * sai. Um número pode estar "ativo" na conta do intermediário e estar em
 * `account_mode: SANDBOX` ou reprovado na revisão da Meta; nesse caso o envio
 * falha e nada na tela do CRM tinha como avisar antes.
 *
 * 401 é DESCONECTADO e não "não deu para perguntar": o token de gateway é a
 * credencial de envio, e um token recusado significa que este canal não envia
 * mais — informação boa, que precisa chegar à tela.
 */
async function saudePeloGateway(token: string): Promise<ChannelHealth> {
  let res: Response;
  try {
    res = await fetch(`${stevoBaseUrlOficial()}/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { reachable: false, status: null, detail: "o provedor não respondeu" };
  }

  if (res.status === 401) {
    return {
      reachable: true,
      status: "FAILED",
      detail: "token de envio recusado — gere um novo no painel e cole de novo",
    };
  }
  if (!res.ok) {
    return { reachable: false, status: null, detail: `o provedor respondeu ${res.status}` };
  }

  const corpo = (await res.json().catch(() => null)) as {
    account_mode?: string;
    account_review_status?: string;
    quality_rating?: string;
  } | null;

  // `LIVE` é o único modo que entrega para número de fora; `SANDBOX` entrega só
  // para os números de teste cadastrados, e a diferença é invisível até a
  // primeira mensagem que não chega.
  const aoVivo = (corpo?.account_mode ?? "").toUpperCase() === "LIVE";
  if (!aoVivo) {
    return {
      reachable: true,
      status: "STOPPED",
      detail: `número não está em produção na Meta (${corpo?.account_mode ?? "modo desconhecido"})`,
    };
  }

  return {
    reachable: true,
    status: "WORKING",
    // Qualidade não bloqueia envio, mas é o aviso que antecede a restrição da
    // Meta. Vai no detalhe quando não está no verde.
    detail:
      (corpo?.quality_rating ?? "").toUpperCase() === "GREEN"
        ? null
        : `qualidade do número: ${corpo?.quality_rating ?? "desconhecida"}`,
  };
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
    const escopo = {
      organizationId: envelope.organizationId,
      instanceId: envelope.sessionRef,
    };

    // Gateway PRIMEIRO, e a ordem não é preferência: token de gateway gravado
    // só existe em instância da API Oficial, e para ela o proxy é um 409 certo.
    // Perguntar ao proxy antes seria gastar uma ida à rede para ouvir "não".
    const tokenDoGateway = await stevoOfficialToken(admin, escopo);
    if (tokenDoGateway) return enviarPeloGateway(envelope, tokenDoGateway);

    const creds = await resolveStevoCreds(admin, escopo);
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
      // A spec devolve `{error: {code, message}}` — OBJETO, nunca string.
      // `?? string` aqui era o bug: interpolar o objeto direto num template
      // literal vira `"[object Object]"`, o que a tela mostrava no lugar do
      // motivo de verdade.
      error?: { code?: string; message?: string } | string;
      message?: string;
    } | null;

    // `sent: false` com HTTP 2xx é um desfecho real deste contrato: a chamada
    // chegou, o motor recusou. Tratar só o status HTTP diria "enviado" para uma
    // mensagem que o provedor acabou de recusar.
    if (!res.ok || json?.sent === false) {
      const erro = json?.error;
      const detalhe =
        typeof erro === "string"
          ? erro
          : (erro?.message ?? erro?.code ?? json?.message ?? res.statusText);
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
    const escopo = { organizationId: input.organizationId, instanceId: input.sessionRef };

    // Quem envia pelo gateway é perguntado AO GATEWAY. A API de conta responde
    // `connected: true` para instância oficial sem olhar o número na Meta — foi
    // exatamente essa resposta que fez a tela mostrar "conectado" para um canal
    // que não conseguia enviar, e o operador só descobrir mandando mensagem.
    const tokenDoGateway = await stevoOfficialToken(admin, escopo);
    if (tokenDoGateway) return saudePeloGateway(tokenDoGateway);

    const creds = await resolveStevoCreds(admin, escopo);
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
