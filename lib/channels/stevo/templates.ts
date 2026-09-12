/**
 * As definições aprovadas do canal intermediado OFICIAL — pelo gateway dele.
 *
 * ─── Por que isto faltava, e o que custava ──────────────────────────────────
 *
 * O adapter deste canal ganhou `sendTemplate` sem ganhar `templates`, e o efeito
 * apareceu na tela do jeito mais enganoso possível: o bloco de fluxo oferecia
 * "usar um modelo aprovado", o operador escolhia a conexão, e a lista vinha
 * VAZIA — porque a rota lê o espelho local (`meta_templates`) e nada nunca
 * escrevia ali para este canal. A conta estava cheia de modelos aprovados.
 *
 * ─── O endereço, medido e não deduzido ──────────────────────────────────────
 *
 * O gateway responde `401 {"error":"unauthorized"}` em `GET /v1/templates` (a
 * rota existe, falta token) e `404 Route GET:/v1/message_templates not found`
 * no nome da Graph API. Confirmado depois no OpenAPI publicado dele
 * (`doc.stevo.chat/api/whatsapp-oficial.v1.yaml`, "Lista templates (HSM) da
 * WABA"), que documenta o corpo como o CRU da Meta: `{ data: [...] }`.
 *
 * ─── As definições são da WABA, não do intermediário ────────────────────────
 *
 * Mesma nota do outro canal intermediado: o gateway é outra porta para o mesmo
 * armário da Meta. Um modelo criado por aqui entra na fila de revisão DELA, e
 * `meta_templates` continua sendo o espelho certo — tratar isto como um segundo
 * catálogo criaria duas fontes da verdade para a mesma linha.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import type {
  ChannelTemplate,
  ChannelTemplateDraft,
  ChannelTemplateOps,
  ChannelTenantScope,
} from "../types";

import { resolveEnvioStevo, stevoBaseUrlOficial } from "./credentials";

/** A forma crua da Meta, que o gateway repassa sem traduzir. */
interface TemplateCru {
  name?: string;
  language?: string;
  status?: string;
  category?: string | null;
  components?: unknown[];
  rejected_reason?: string | null;
  parameter_format?: string | null;
}

function paraNeutro(t: TemplateCru): ChannelTemplate {
  return {
    name: t.name ?? "",
    language: t.language ?? "",
    // Vocabulário ABERTO: a plataforma cria estado novo sem avisar, e um
    // `as const` aqui viraria erro de runtime no dia em que ela inventar um.
    status: t.status ?? "UNKNOWN",
    category: t.category ?? null,
    components: Array.isArray(t.components) ? t.components : [],
    rejectedReason: t.rejected_reason ?? null,
    parameterFormat: t.parameter_format ?? null,
  };
}

/**
 * O token do gateway desta instância.
 *
 * Lança com NOME PRÓPRIO quando a instância não o tem: é o estado de um número
 * ligado por QR na mesma conta, que não tem WABA por trás e portanto não tem
 * definição nenhuma. Deixar a chamada sair sem token devolveria `401` e mandaria
 * o operador procurar no lugar errado.
 */
async function tokenDoGateway(input: ChannelTenantScope & { sessionRef: string }): Promise<string> {
  const envio = await resolveEnvioStevo(createAdminClient(), {
    organizationId: input.organizationId,
    instanceId: input.sessionRef,
  });
  if (envio?.transporte !== "gateway") {
    throw new Error(
      "stevo_sem_gateway: esta conexão não tem token da API Oficial gravado — " +
        "definição aprovada só existe em instância oficial. Cole o token em Conexões.",
    );
  }
  return envio.token;
}

async function chamar(
  token: string,
  caminho: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${stevoBaseUrlOficial()}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const json = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
    meta?: { error?: { code?: number; message?: string; error_data?: { details?: string } } };
  } | null;

  if (!res.ok) {
    // A mensagem da plataforma CHEGA ao operador: é ela que distingue "token
    // vencido" de "conta sem permissão", e sem ela a tela diz só "falhou".
    const daMeta = json?.meta?.error;
    const detalhe =
      daMeta?.error_data?.details ?? daMeta?.message ?? json?.message ?? json?.error ?? res.statusText;
    const codigo = daMeta?.code !== undefined ? ` (meta ${daMeta.code})` : "";
    throw new Error(`stevo_templates_failed: ${res.status} ${detalhe}${codigo}`.trim());
  }

  return (json ?? {}) as Record<string, unknown>;
}

/** Os campos que a listagem precisa trazer — o gateway devolve só o que se pede. */
const CAMPOS = "name,status,language,category,components,parameter_format,rejected_reason";

export const stevoTemplateOps: ChannelTemplateOps = {
  async list(input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelTemplate[]> {
    const token = await tokenDoGateway(input);
    // `limit` explícito: o default documentado é 100, e uma conta com mais
    // definições que isso perderia as últimas em silêncio — que é o mesmo
    // sintoma que este arquivo existe para acabar.
    const corpo = await chamar(token, `/v1/templates?fields=${CAMPOS}&limit=250`);
    const lista = corpo.data;
    return Array.isArray(lista) ? lista.map((t) => paraNeutro(t as TemplateCru)) : [];
  },

  async create(
    input: ChannelTenantScope & { sessionRef: string; draft: ChannelTemplateDraft },
  ): Promise<ChannelTemplate> {
    const token = await tokenDoGateway(input);
    await chamar(token, "/v1/templates", {
      method: "POST",
      body: JSON.stringify({
        name: input.draft.name,
        language: input.draft.language,
        category: input.draft.category,
        components: input.draft.components,
      }),
    });
    // A plataforma devolve o id da criação, não a definição pronta: ela nasce
    // em revisão. Quem mostra o estado é a sincronização logo depois — a rota
    // sincroniza sempre, inclusive depois de criar, para o operador VER que a
    // definição existe e está pendente, em vez de criar a mesma de novo.
    return {
      name: input.draft.name,
      language: input.draft.language,
      status: "PENDING",
      category: input.draft.category,
      components: input.draft.components,
    };
  },

  /**
   * ⚠️ O gateway NÃO expõe edição — o OpenAPI dele tem `get`, `post` e `delete`
   * em `/v1/templates`, e mais nada.
   *
   * Lança com o caminho de volta escrito, em vez de fingir que editou ou de
   * devolver um `501` mudo: editar um template aprovado o joga de volta para
   * revisão de qualquer forma, então recriar com outro nome é o que o operador
   * acabaria fazendo.
   */
  async update(): Promise<ChannelTemplate> {
    throw new Error(
      "stevo_template_sem_edicao: esta conexão não edita definição pela API. " +
        "Apague e crie de novo, ou edite no painel da plataforma.",
    );
  },

  async remove(
    input: ChannelTenantScope & { sessionRef: string; name: string },
  ): Promise<void> {
    const token = await tokenDoGateway(input);
    // A remoção é POR NOME e apaga TODOS os idiomas daquele nome — é o contrato
    // da plataforma, não uma simplificação nossa. Por isso `language` não entra.
    await chamar(token, `/v1/templates?name=${encodeURIComponent(input.name)}`, {
      method: "DELETE",
    });
  },
};
