/**
 * O endereço público do gatilho por webhook, criado ao PUBLICAR.
 *
 * ## Por que ao publicar, e não ao arrastar o bloco
 *
 * Porque só o fluxo publicado roda. Um token criado no rascunho é um endereço
 * vivo para um fluxo que não existe: quem o copiasse para o sistema de fora
 * teria um webhook que responde 200 e não faz nada — falha muda, do lado de
 * fora, onde ninguém deste produto olha.
 *
 * ## Por que o token é ESTÁVEL entre publicações
 *
 * Porque ele já foi copiado. Republicar o fluxo com o mesmo bloco não pode
 * trocar o endereço que o sistema do cliente chama há três meses — seria uma
 * integração quebrada por um clique de "publicar" que não mudou nada
 * relacionado a ela.
 *
 * ## Por que a linha vive em `webhook_sources`
 *
 * Porque é ela quem já responde "de quem é este token": tem RLS, segredo
 * cifrado, e a rota pública irmã. Uma tabela própria daria dois lugares para
 * responder a mesma pergunta, e é assim que um token vaza para a organização
 * errada. A 0207 já tinha aberto `kind = 'flow_trigger'` para isto; a 0211
 * terminou o serviço.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** O bloco de gatilho por webhook, como ele aparece no grafo publicado. */
const TIPO_DO_GATILHO = "trigger.webhook";

interface NoDoGrafo {
  id: string;
  type: string;
  label?: string;
}

export interface GatilhoPublicado {
  nodeId: string;
  pathToken: string;
}

/**
 * Garante uma linha de gatilho por bloco `trigger.webhook` do grafo publicado.
 *
 * Melhor esforço por decisão: uma falha aqui NÃO desfaz a publicação. O fluxo
 * publicado sem token é um gatilho que não dispara — ruim, e visível na tela de
 * webhooks; a publicação desfeita por causa disso derrubaria também os outros
 * blocos do fluxo, que não têm nada com isso.
 */
export async function garantirGatilhosDeWebhook(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    flowId: string;
    flowName: string;
    grafo: { nodes?: NoDoGrafo[] };
    criadoPorUserId: string | null;
  },
): Promise<GatilhoPublicado[]> {
  const blocos = (input.grafo.nodes ?? []).filter((n) => n.type === TIPO_DO_GATILHO);
  if (blocos.length === 0) return [];

  const { data: existentesData } = await admin
    .from("webhook_sources")
    .select("id, name, path_token")
    .eq("organization_id", input.organizationId)
    .eq("flow_id", input.flowId)
    .eq("kind", "flow_trigger");

  // O `name` carrega o id do bloco: é o que liga a linha ao bloco entre
  // publicações, sem coluna nova. Dois blocos de gatilho no mesmo fluxo são
  // dois tokens, e cada um continua o seu.
  const porBloco = new Map<string, { id: string; path_token: string }>();
  for (const linha of (existentesData ?? []) as Array<{
    id: string;
    name: string;
    path_token: string;
  }>) {
    const marca = linha.name.match(/\[no:([^\]]+)\]/u);
    if (marca?.[1] !== undefined) porBloco.set(marca[1], { id: linha.id, path_token: linha.path_token });
  }

  const publicados: GatilhoPublicado[] = [];

  for (const bloco of blocos) {
    const jaExiste = porBloco.get(bloco.id);
    if (jaExiste !== undefined) {
      publicados.push({ nodeId: bloco.id, pathToken: jaExiste.path_token });
      continue;
    }

    // 24 bytes em base64url: o token é a ÚNICA credencial desta URL, e ela vive
    // em texto no sistema de terceiros que a chama. Curto demais aqui é força
    // bruta viável contra um endereço público.
    const pathToken = randomBytes(24).toString("base64url");
    const { error } = await admin.from("webhook_sources").insert({
      organization_id: input.organizationId,
      name: `${input.flowName} [no:${bloco.id}]`,
      path_token: pathToken,
      kind: "flow_trigger",
      flow_id: input.flowId,
      is_active: true,
      created_by_user_id: input.criadoPorUserId,
    });

    if (error !== null) {
      logger.error("[flow.webhook] nao consegui criar o gatilho", {
        flowId: input.flowId,
        nodeId: bloco.id,
        erro: error.message,
      });
      continue;
    }
    publicados.push({ nodeId: bloco.id, pathToken });
  }

  return publicados;
}
