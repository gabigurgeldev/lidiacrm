/**
 * GUARDAR A CHAVE DE UM PROVEDOR DE IA — o miolo, sem HTTP.
 *
 * Extraído de `POST /api/v1/ai/credentials` porque agora há um SEGUNDO caminho
 * que precisa exatamente disto: o wizard. O passo de treinar detecta que a
 * instalação não tem chave nenhuma e oferece colar uma ali — antes ele apenas
 * informava "Falta a chave da inteligência artificial", que é um beco: a pessoa
 * lê o diagnóstico e não tem o que fazer com ele.
 *
 * O que mora aqui é o que os dois caminhos precisam fazer IGUAL, e cada item
 * desta lista tem consequência de segurança se divergir: cifrar AES-GCM (nunca
 * guardar plaintext), gravar só os últimos 4 dígitos em claro, registrar no
 * audit, e validar a chave em segundo plano sem segurar a resposta. Uma segunda
 * cópia disso na Server Action divergiria no primeiro ajuste — e o ajuste que
 * divergisse seria justamente o de segurança.
 *
 * O que NÃO mora aqui: autenticação, papel e formato do erro. São do chamador,
 * porque a rota responde JSON com `requestId` e a Server Action responde para
 * uma tela em português.
 */
import { audit } from "@/lib/audit";
import { bufToBytea, encryptKey, ChaveDeCifragemInvalida } from "@/lib/crypto/aes_gcm";
import { logger } from "@/lib/logger";
import { validateProviderKey, type Provider } from "@/lib/ai/provider-validators";
import type { createAdminClient } from "@/lib/supabase/admin";

export type ResultadoDeGuardar =
  | { ok: true; id: string; last4: string }
  | {
      ok: false;
      /**
       * `label_em_uso` é escolha do usuário e tem conserto óbvio (mudar o nome).
       *
       * `chave_de_cifragem_da_instalacao` é o outro que o chamador PRECISA
       * distinguir, e por motivo oposto: quem está na tela não pode fazer nada,
       * mas quem administra a instalação pode — e só descobre se a mensagem
       * disser. Enquanto isso caía no balde de "erro interno", uma instalação
       * com a chave em formato errado ficava sem cadastro de IA para sempre,
       * sem uma linha de log dizendo por quê.
       *
       * O resto é falha nossa.
       */
      motivo: "cifragem" | "chave_de_cifragem_da_instalacao" | "label_em_uso" | "banco";
      detalhe?: string;
    };

export interface PedidoDeGuardar {
  admin: ReturnType<typeof createAdminClient>;
  orgId: string;
  userId: string;
  provider: Provider;
  label: string;
  /** Plaintext. Vive só no escopo desta chamada — nunca persistido nem logado. */
  apiKey: string;
  requestId?: string;
}

export async function guardarCredencial(p: PedidoDeGuardar): Promise<ResultadoDeGuardar> {
  let encrypted;
  try {
    encrypted = encryptKey(p.apiKey);
  } catch (err) {
    // Nada da chave do usuário entra aqui — `ChaveDeCifragemInvalida` fala
    // apenas do formato da AI_CRED_AES_KEY da instalação, e `logger` não recebe
    // `p.apiKey` em campo nenhum.
    //
    // O log existe porque a ausência dele custou um diagnóstico inteiro: esta
    // falha acontece ANTES do INSERT, então nem o log do app nem o do Postgres
    // registravam coisa alguma, e o sintoma na tela era só "Erro interno".
    const configurada = err instanceof ChaveDeCifragemInvalida;
    logger.error("ai.credencial.cifragem_falhou", {
      organizationId: p.orgId,
      provider: p.provider,
      ...(p.requestId ? { requestId: p.requestId } : {}),
      motivo: err instanceof Error ? err.message : "desconhecido",
      ...(configurada ? { comoCorrigir: (err as ChaveDeCifragemInvalida).comoCorrigir } : {}),
    });
    return {
      ok: false,
      motivo: configurada ? "chave_de_cifragem_da_instalacao" : "cifragem",
      detalhe: err instanceof Error ? err.message : undefined,
    };
  }

  const { data: created, error } = await p.admin
    .from("ai_provider_credentials")
    .insert({
      organization_id: p.orgId,
      provider: p.provider,
      label: p.label,
      api_key_encrypted: bufToBytea(encrypted.ciphertext),
      api_key_iv: bufToBytea(encrypted.iv),
      api_key_tag: bufToBytea(encrypted.tag),
      api_key_last4: encrypted.last4,
      is_active: true,
      created_by: p.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505") return { ok: false, motivo: "label_em_uso" };
    return { ok: false, motivo: "banco", detalhe: error?.message };
  }

  const id = created.id as string;

  await audit({
    action: "ai.credential_created",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "ai_provider_credential",
    resourceId: id,
    ...(p.requestId ? { requestId: p.requestId } : {}),
    metadata: { provider: p.provider, label: p.label, last4: encrypted.last4 },
  });

  // Fire-and-forget: o plaintext vive até o callback resolver, e a resposta não
  // espera uma ida ao provedor. Guardar a chave e validá-la são coisas
  // diferentes — a segunda pode falhar por rede sem que a primeira precise ser
  // desfeita.
  void validarEmSegundoPlano(p.admin, id, p.orgId, p.provider, p.apiKey);

  return { ok: true, id, last4: encrypted.last4 };
}

async function validarEmSegundoPlano(
  admin: ReturnType<typeof createAdminClient>,
  credentialId: string,
  organizationId: string,
  provider: Provider,
  apiKey: string,
): Promise<void> {
  try {
    const r = await validateProviderKey(provider, apiKey);
    await admin
      .from("ai_provider_credentials")
      .update(
        r.ok
          ? {
              validated_at: new Date().toISOString(),
              validation_error: null,
              models_available: r.models,
            }
          : { validated_at: null, validation_error: r.error },
      )
      .eq("id", credentialId)
      .eq("organization_id", organizationId);
  } catch {
    // Falha de rede na validação não pode derrubar nada: a credencial existe e
    // o campo `validated_at` continua nulo, que é a leitura honesta de "ainda
    // não sei".
  }
}
