/**
 * O que o link de pareamento precisa saber sobre o CANAL — dentro de
 * `lib/channels/`, que é a única casa onde o nome do provider pode aparecer.
 *
 * As rotas do pareamento (uma autenticada, duas públicas) precisavam ler a
 * coluna da sessão do transporte e falar com ele para buscar o QR. Fazer isso
 * na rota nomeia o provider fora daqui, e o `pnpm lint:channels` reprova —
 * reprovou, de fato, a primeira versão destas rotas. As três chamam este
 * módulo e recebem tudo resolvido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";

export type CanalParaParear =
  | { ok: true; sessionRef: string }
  | { ok: false; motivo: "nao_encontrado" | "arquivado" | "sem_qr" };

/**
 * Este canal pode ser pareado por QR agora?
 *
 * As duas recusas são as MESMAS da rota de QR autenticada, e pelas mesmas
 * razões já pagas ali: um canal arquivado religado pelo celular fica "vivo e
 * surdo" (o aparelho pareia, a linha segue arquivada, ninguém atende), e canal
 * oficial não tem sessão no transporte — o identificador é NULL nele por CHECK,
 * e seguir com ele viraria uma URL `/api/null/...`, cujo 404 é indistinguível
 * de "o QR ainda não ficou pronto", que é o estado em que a tela fica
 * insistindo para sempre.
 *
 * `organization_id` entra na consulta À MÃO porque quem chama usa service role,
 * que bypassa a RLS. Sem ele, um id de canal de outra organização geraria um
 * link válido para o WhatsApp dela.
 */
export async function canalParaParear(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<CanalParaParear> {
  const buscar = (colunas: string) => () =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("id", channelSessionId)
      .maybeSingle();
  // Tolerante à coluna ausente pela mesma razão da rota de QR: num clone sem a
  // 0106 nada está arquivado, e exigir a coluna apagaria o pareamento inteiro.
  const { data } = await queryTolerantToMissingArchived(
    buscar(`waha_session_name, ${ARCHIVED_AT}`),
    buscar("waha_session_name"),
  );
  const linha = data as { waha_session_name: string | null; archived_at?: string | null } | null;

  if (!linha) return { ok: false, motivo: "nao_encontrado" };
  if (linha.archived_at) return { ok: false, motivo: "arquivado" };
  if (!linha.waha_session_name) return { ok: false, motivo: "sem_qr" };
  return { ok: true, sessionRef: linha.waha_session_name };
}

/** O apelido e o estado da linha — o pouco que a página pública mostra. */
export async function linhaParaPagina(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<{ nome: string | null; status: string | null; arquivado: boolean } | null> {
  const buscar = (colunas: string) => () =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("id", channelSessionId)
      .maybeSingle();
  const { data } = await queryTolerantToMissingArchived(
    buscar(`display_name, status, ${ARCHIVED_AT}`),
    buscar("display_name, status"),
  );
  const linha = data as {
    display_name: string | null;
    status: string | null;
    archived_at?: string | null;
  } | null;
  if (!linha) return null;
  return {
    nome: linha.display_name,
    status: linha.status,
    arquivado: Boolean(linha.archived_at),
  };
}

export type QrDoTransporte =
  | { ok: true; corpo: ArrayBuffer; contentType: string }
  | { ok: false; motivo: "sem_transporte"; status: 503 }
  | { ok: false; motivo: "upstream"; status: number };

/**
 * A imagem do QR, buscada no transporte pelo SERVIDOR.
 *
 * Proxy e não redirect porque a chamada leva a chave do transporte no
 * cabeçalho, e ela não pode chegar ao browser — aqui isso pesa mais que na rota
 * autenticada, porque o browser é o do CLIENTE, fora da organização.
 */
export async function qrDoTransporte(sessionRef: string): Promise<QrDoTransporte> {
  const baseUrl = process.env.WAHA_API_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  // A chave de exemplo conta como ausente: com ela o transporte recusa tudo, e
  // um 401 lá vira "QR não ficou pronto" aqui.
  if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") {
    return { ok: false, motivo: "sem_transporte", status: 503 };
  }

  const upstream = await fetch(
    `${baseUrl}/api/${encodeURIComponent(sessionRef)}/auth/qr?format=image`,
    { headers: { "X-Api-Key": apiKey }, cache: "no-store" },
  );
  if (!upstream.ok) return { ok: false, motivo: "upstream", status: upstream.status };

  return {
    ok: true,
    corpo: await upstream.arrayBuffer(),
    contentType: upstream.headers.get("content-type") ?? "image/png",
  };
}
