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
import { reiniciarSessaoDoCanal } from "../reconectar";

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

/**
 * Em que pé está a sessão NO TRANSPORTE — o estado vivo, não a coluna.
 *
 * A coluna `channel_sessions.status` é o que o webhook contou por último, e o
 * link de pareamento é gerado justamente para canal caído: ali ela costuma
 * dizer `FAILED` há horas. Decidir pelo transporte é decidir pelo que o QR
 * depende de verdade.
 */
export type EstadoNoTransporte =
  | "pronto" // SCAN_QR_CODE — há QR para mostrar
  | "conectado" // WORKING
  | "iniciando" // STARTING — o QR vem em segundos
  | "parado" // STOPPED
  | "falhou" // FAILED — credencial morta, em geral
  | "ausente" // a sessão não existe no transporte
  | "sem_transporte"
  | "indisponivel"; // transporte fora do ar ou respondendo erro

export async function estadoNoTransporte(sessionRef: string): Promise<EstadoNoTransporte> {
  const baseUrl = process.env.WAHA_API_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") return "sem_transporte";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionRef)}`, {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
    });
  } catch {
    return "indisponivel";
  }
  if (res.status === 404) return "ausente";
  if (!res.ok) return "indisponivel";

  const corpo = (await res.json().catch(() => null)) as { status?: string } | null;
  switch (corpo?.status) {
    case "SCAN_QR_CODE":
      return "pronto";
    case "WORKING":
      return "conectado";
    case "STARTING":
      return "iniciando";
    case "STOPPED":
      return "parado";
    case "FAILED":
      return "falhou";
    default:
      return "indisponivel";
  }
}

/**
 * Este estado pede que a sessão seja (re)iniciada para o QR aparecer?
 *
 * ⚠️ Era o defeito: o link era gerado para um canal `FAILED`, a página pedia o
 * QR, o transporte respondia 422 ("sessão não está em SCAN_QR_CODE") e a tela
 * ficava com o quadro do QR em branco até o link expirar. Nada no caminho do
 * link subia a sessão — no CRM logado quem faz isso é o botão "Reconectar", e
 * o dono do celular, do outro lado do link, não tem botão nenhum.
 *
 * O modo segue a doutrina da rota de reconectar: suave primeiro. `parado` e
 * `ausente` sobem sem descartar credencial — se ela ainda vale, o aparelho volta
 * sozinho para WORKING e a página diz "Conectado!". `falhou` descarta a
 * credencial (logout): é o estado em que o start comum reaproveita a credencial
 * morta e volta direto para FAILED, sem nunca passar por SCAN_QR_CODE. Aqui não
 * há perda em forçar — quem abriu o link está com o celular na mão para
 * escanear, que é exatamente o que o logout pede.
 */
export function reinicioNecessario(estado: EstadoNoTransporte): { forcar: boolean } | null {
  if (estado === "falhou") return { forcar: true };
  if (estado === "parado" || estado === "ausente") return { forcar: false };
  return null;
}

export type PreparoDoQr = {
  qrPronto: boolean;
  /** Preenchido só quando ESTA chamada reiniciou a sessão — é o que audita. */
  reiniciou: { forcar: boolean } | null;
};

/**
 * Deixa a sessão do canal em condição de mostrar QR, e diz se já há QR.
 *
 * `podeReiniciar` é a trava de frequência, decidida por quem chama (a rota tem
 * o token e o rate limit). Sem ela, uma sessão que volta para FAILED logo após
 * subir seria reiniciada a cada 3s de polling — logout em laço no transporte.
 *
 * `organization_id` vem do LINK, e `reiniciarSessaoDoCanal` o filtra à mão:
 * quem chama usa service role.
 */
export async function prepararSessaoParaQr(
  admin: SupabaseClient,
  alvo: { organizationId: string; channelSessionId: string },
  podeReiniciar: () => Promise<boolean>,
): Promise<PreparoDoQr> {
  const canal = await canalParaParear(admin, alvo.organizationId, alvo.channelSessionId);
  if (!canal.ok) return { qrPronto: false, reiniciou: null };

  const estado = await estadoNoTransporte(canal.sessionRef);
  if (estado === "pronto") return { qrPronto: true, reiniciou: null };

  const reinicio = reinicioNecessario(estado);
  if (!reinicio || !(await podeReiniciar())) return { qrPronto: false, reiniciou: null };

  const r = await reiniciarSessaoDoCanal(admin, { ...alvo, forcar: reinicio.forcar });
  if (!r.ok) return { qrPronto: false, reiniciou: null };
  return { qrPronto: r.status === "SCAN_QR_CODE", reiniciou: reinicio };
}
