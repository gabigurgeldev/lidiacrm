/**
 * LINK PÚBLICO DE PAREAMENTO — a regra, num lugar só.
 *
 * ═══ O que este módulo protege ═══
 *
 * Quem abre o link **pareia um WhatsApp na operação de um cliente**. Não há
 * sessão, não há cookie, não há segundo fator: o token É a credencial. Por isso
 * toda decisão sobre validade mora aqui e não nas rotas — três rotas decidindo
 * "este link ainda vale?" por conta própria divergem na primeira mudança, e a
 * que divergir para o lado permissivo é uma porta aberta que ninguém vê.
 *
 * ═══ Por que a mesma resposta para inexistente, expirado, revogado e usado ═══
 *
 * Um link morto e um link que nunca existiu respondem IGUAL. Distinguir os dois
 * transformaria a rota pública num oráculo: quem varre tokens saberia quais já
 * existiram, e "existiu" é a metade difícil de adivinhar em 192 bits.
 *
 * O motivo detalhado existe — a PÁGINA precisa dizer "expirou, peça outro" em
 * vez de "não encontrado" — mas ele só é revelado para um token que EXISTE e
 * está morto por tempo ou cancelamento. Nunca para um token desconhecido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** 30 minutos, fixo. Ver `MOTIVO_DO_PRAZO`. */
export const VALIDADE_DO_LINK_MS = 30 * 60 * 1000;

/**
 * Fixo e não configurável de propósito: o prazo é uma trava de segurança, e um
 * campo na tela convida a esticá-lo justamente quando alguém está com pressa —
 * que é quando a trava importa. Quem perdeu o prazo gera outro em dois cliques.
 */
export const MOTIVO_DO_PRAZO =
  "quem tem o link pareia um aparelho na operação; a janela curta é a trava";

export interface LinkDePareamento {
  id: string;
  organizationId: string;
  channelSessionId: string;
  expiresAt: string;
}

export type LeituraDoLink =
  | { ok: true; link: LinkDePareamento }
  | { ok: false; motivo: "desconhecido" | "expirado" | "cancelado" | "usado" };

const COLUNAS = "id, organization_id, channel_session_id, expires_at, consumed_at, revoked_at";

interface LinhaDoLink {
  id: string;
  organization_id: string;
  channel_session_id: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

/**
 * O link que este token nomeia, se ele ainda vale.
 *
 * `admin` (service role) de propósito: quem abre a página não tem sessão, então
 * não há RLS que o alcance. A CONTRAPARTIDA obrigatória é que o
 * `organization_id` sai DAQUI — da linha encontrada pelo token — e nunca do
 * corpo ou da URL, que é a regra do repo para todo handler que usa service role.
 *
 * `agora` entra por parâmetro para o teste poder atravessar a expiração sem
 * mexer no relógio do processo.
 */
export async function lerLinkDePareamento(
  admin: SupabaseClient,
  token: string,
  agora: Date = new Date(),
): Promise<LeituraDoLink> {
  // Piso de tamanho antes de ir ao banco: o token tem 48 caracteres hex, e uma
  // string vazia ou de 2 caracteres é varredura, não engano de digitação.
  if (!token || token.length < 16 || token.length > 200) {
    return { ok: false, motivo: "desconhecido" };
  }

  const { data, error } = await admin
    .from("channel_pairing_links")
    .select(COLUNAS)
    .eq("token", token)
    .maybeSingle();

  // Erro de consulta NÃO vira "desconhecido": um banco fora do ar respondendo
  // "link inválido" mandaria o cliente pedir link novo a cada tentativa, para
  // sempre. O chamador transforma isto em 503.
  if (error) throw new Error(`pairing_link_lookup_failed: ${error.code ?? "sem_codigo"}`);
  if (!data) return { ok: false, motivo: "desconhecido" };

  const linha = data as unknown as LinhaDoLink;
  if (linha.revoked_at) return { ok: false, motivo: "cancelado" };
  if (linha.consumed_at) return { ok: false, motivo: "usado" };
  if (new Date(linha.expires_at).getTime() <= agora.getTime()) {
    return { ok: false, motivo: "expirado" };
  }

  return {
    ok: true,
    link: {
      id: linha.id,
      organizationId: linha.organization_id,
      channelSessionId: linha.channel_session_id,
      expiresAt: linha.expires_at,
    },
  };
}

/**
 * Marca o link como usado. É o que implementa "morre ao conectar".
 *
 * Chamado pelo SERVIDOR, quando ele mesmo vê o canal em `WORKING` — nunca a
 * pedido do cliente. Um endpoint "já conectei" seria uma forma de qualquer um
 * matar o link de outro.
 *
 * `is("consumed_at", null)` no update: duas abas da mesma página consumindo ao
 * mesmo tempo gravariam dois horários diferentes, e o primeiro é o verdadeiro.
 */
export async function marcarLinkComoUsado(
  admin: SupabaseClient,
  linkId: string,
  quando: Date = new Date(),
): Promise<void> {
  await admin
    .from("channel_pairing_links")
    .update({ consumed_at: quando.toISOString() })
    .eq("id", linkId)
    .is("consumed_at", null);
}

/** Quantos segundos faltam. Nunca negativo — a página mostra este número. */
export function segundosAteExpirar(expiresAt: string, agora: Date = new Date()): number {
  const restante = new Date(expiresAt).getTime() - agora.getTime();
  return restante > 0 ? Math.floor(restante / 1000) : 0;
}
