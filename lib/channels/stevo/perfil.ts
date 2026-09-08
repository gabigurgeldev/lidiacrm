/**
 * A foto de perfil de um contato no intermediário de conta — SÓ o que dá.
 *
 * ═══ ⚠️ Por que isto é best-effort, e o que É certo ═══
 *
 * A modalidade OFICIAL deste canal é a WhatsApp Cloud API da Meta por baixo, e a
 * Cloud API **não tem** endpoint para a foto de perfil de um contato — é decisão
 * de privacidade da Meta, não limitação nossa. Então em instância oficial esta
 * função devolve `null` SEMPRE, por design: não há foto a buscar, e insistir só
 * gasta rede. É por isso que o avatar de contato de um número oficial fica na
 * silhueta — e isso é o correto, não um bug.
 *
 * A modalidade por QR (motor SM v2) é WhatsApp comum e PODE expor a foto. O
 * caminho exato NÃO está nos specs públicos do provedor (o mesmo motivo do
 * cabeçalho de `webhook.ts`), então o endpoint abaixo é o palpite mais plausível
 * e o modo de falha é honesto: qualquer não-2xx, corpo inesperado ou erro de
 * rede devolve `null`, e o contato fica com a silhueta — nunca quebra. Ao MEDIR
 * o caminho real numa instância viva, é aqui que se aperta.
 */

const TIMEOUT_MS = 15_000;

const CHAVES_DE_URL = [
  "profilePictureUrl",
  "profile_picture_url",
  "profilePicUrl",
  "profile_pic_url",
  "pictureUrl",
  "picture",
  "avatar",
  "image",
  "url",
];

/** Procura, raso, o primeiro campo que pareça a URL da foto. */
function acharUrl(v: unknown): string | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of CHAVES_DE_URL) {
    const achado = o[k];
    if (typeof achado === "string" && /^https?:\/\//.test(achado.trim())) return achado.trim();
  }
  // Um nível de aninhamento (`{data: {...}}` / `{result: {...}}`).
  for (const filho of Object.values(o)) {
    if (filho !== null && typeof filho === "object") {
      const achado = acharUrl(filho);
      if (achado) return achado;
    }
  }
  return null;
}

/**
 * URL (temporária) da foto de perfil, ou `null` quando não há — sem NUNCA lançar.
 * Quem chama deve BAIXAR e persistir, nunca guardar a URL (ela expira).
 */
export async function fetchFotoDePerfilStevo(input: {
  apiKey: string;
  baseUrl: string;
  instanceId: string;
  /** Telefone do contato, só dígitos. */
  numero: string;
}): Promise<string | null> {
  const url = `${input.baseUrl}/v1/instances/${encodeURIComponent(
    input.instanceId,
  )}/contacts/${encodeURIComponent(input.numero)}/profile-picture`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${input.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const corpo = await r.json().catch(() => null);
    return acharUrl(corpo);
  } catch {
    return null;
  }
}
