/**
 * CRIAR UMA PESSOA DENTRO DE UMA ORGANIZAÇÃO — o miolo, sem HTTP.
 *
 * Existe porque adicionar alguém ao time dependia de e-mail. O convite era um
 * token HMAC mandado por Resend, e sem `RESEND_API_KEY` — o estado real de toda
 * instalação recém-feita — o caminho terminava num link cru na tela para a
 * pessoa copiar à mão. Um caminho de entrada que depende de e-mail configurado
 * é um caminho que não funciona no dia da instalação.
 *
 * O padrão aqui não é novo: `scripts/bootstrap-owner.ts` já cria o dono assim
 * (`createUser` + linha em `user_organizations`). O que mudou é ele passar a
 * existir DENTRO do runtime, num lugar só, para os dois chamadores — a tela de
 * equipe do tenant e o painel da plataforma. Duas cópias divergiriam no
 * primeiro ajuste, e o ajuste que divergisse seria o de permissão.
 *
 * O que NÃO mora aqui: autenticação, papel de quem chama e formato do erro. São
 * do chamador, porque um responde JSON com `requestId` e o outro responde a uma
 * tela em português.
 */
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/auth/types";

export type ResultadoDeCriar =
  | { ok: true; userId: string; criouConta: boolean }
  | {
      ok: false;
      /**
       * `ja_e_membro` é escolha de quem opera e tem conserto óbvio. Os outros
       * são falha nossa ou do ambiente, e o chamador os trata igual.
       */
      motivo: "ja_e_membro" | "auth" | "banco";
      detalhe?: string;
    };

export interface PedidoDeCriarUsuario {
  admin: ReturnType<typeof createAdminClient>;
  /** Resolvido de fonte confiável pelo chamador — NUNCA do body (CLAUDE.md §10). */
  organizationId: string;
  /** Quem está criando, para o audit. */
  atorUserId: string;
  email: string;
  /** Plaintext. Vive só no escopo desta chamada — nunca logado nem auditado. */
  senha: string;
  papel: Role;
  nome?: string;
  requestId?: string;
}

/**
 * Acha o id de um usuário pelo e-mail.
 *
 * O GoTrue não expõe busca por e-mail, só paginação — então isto percorre as
 * páginas. É chamado APENAS quando a criação falhou por e-mail duplicado, que é
 * o caso raro; o caminho comum não paga esse custo.
 */
async function acharPorEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const alvo = email.trim().toLowerCase();
  const PAGINAS_MAX = 20;
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error || !data) return null;
    const achado = data.users.find((u) => u.email?.toLowerCase() === alvo);
    if (achado) return achado.id;
    if (data.users.length < 200) return null; // última página
  }
  return null;
}

export async function criarUsuarioNaOrganizacao(
  p: PedidoDeCriarUsuario,
): Promise<ResultadoDeCriar> {
  const email = p.email.trim().toLowerCase();

  // Tenta criar direto. O caminho alternativo (e-mail já existe) é descoberto
  // pela recusa do GoTrue, e não por uma varredura preventiva — varrer antes
  // custaria uma paginação inteira em TODA criação para cobrir o caso raro.
  let userId: string | null = null;
  let criouConta = false;

  const { data, error } = await p.admin.auth.admin.createUser({
    email,
    password: p.senha,
    // Sem confirmação por e-mail, de propósito: quem cria já provou a identidade
    // ao acessar o painel, e exigir confirmação traria de volta a dependência de
    // e-mail que esta função existe para remover.
    email_confirm: true,
    user_metadata: p.nome ? { full_name: p.nome } : {},
  });

  if (data?.user) {
    userId = data.user.id;
    criouConta = true;
  } else {
    // Já existe uma conta com este e-mail. Isso NÃO é erro: a pessoa pode já
    // trabalhar em outra organização da mesma instalação. Vinculamos a conta
    // existente — e a senha dela fica INTACTA. Trocar a senha de uma conta que
    // já é de alguém, a partir da tela de outra organização, seria tomar a
    // conta dessa pessoa.
    userId = await acharPorEmail(p.admin, email);
    if (!userId) {
      logger.error("equipe.criar_usuario.auth_falhou", {
        organizationId: p.organizationId,
        ...(p.requestId ? { requestId: p.requestId } : {}),
        motivo: error?.message ?? "createUser não devolveu usuário",
      });
      return { ok: false, motivo: "auth", detalhe: error?.message };
    }
  }

  // Já é membro desta organização?
  const { data: vinculo } = await p.admin
    .from("user_organizations")
    .select("user_id, revoked_at")
    .eq("user_id", userId)
    .eq("organization_id", p.organizationId)
    .maybeSingle();

  if (vinculo && !(vinculo as { revoked_at: string | null }).revoked_at) {
    return { ok: false, motivo: "ja_e_membro" };
  }

  if (vinculo) {
    // Existia e estava revogado: reativa com o papel pedido, em vez de recusar.
    // Recusar obrigaria quem opera a descobrir sozinho que a pessoa já esteve
    // aqui — informação que a tela não mostra.
    const { error: erroUpdate } = await p.admin
      .from("user_organizations")
      .update({ role: p.papel, revoked_at: null, accepted_at: new Date().toISOString() } as never)
      .eq("user_id", userId)
      .eq("organization_id", p.organizationId);
    if (erroUpdate) return { ok: false, motivo: "banco", detalhe: erroUpdate.message };
  } else {
    const { error: erroInsert } = await p.admin.from("user_organizations").insert({
      user_id: userId,
      organization_id: p.organizationId,
      role: p.papel,
      invited_by: p.atorUserId,
      invited_at: new Date().toISOString(),
      // `accepted_at` na hora: não há convite a aceitar — a conta já existe e já
      // tem senha. Deixá-lo nulo faria a tela de equipe mostrar "Pendente" para
      // sempre, para alguém que já pode entrar.
      accepted_at: new Date().toISOString(),
    } as never);
    if (erroInsert) return { ok: false, motivo: "banco", detalhe: erroInsert.message };
  }

  await audit({
    action: "member.created",
    actorUserId: p.atorUserId,
    organizationId: p.organizationId,
    resourceType: "user",
    resourceId: userId,
    ...(p.requestId ? { requestId: p.requestId } : {}),
    // Sem e-mail e sem senha: o audit é lido por gente que não precisa de
    // nenhum dos dois para entender o que houve, e `resourceId` já identifica.
    metadata: { papel: p.papel, criou_conta: criouConta },
  });

  return { ok: true, userId, criouConta };
}
