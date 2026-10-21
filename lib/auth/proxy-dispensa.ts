/**
 * Quando o `proxy.ts` pode deixar a requisição passar SEM perguntar ao GoTrue.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * Medido em produção em 2026-10-21: ~3.675 `GET /user` em 10 minutos, com o
 * GoTrue devolvendo 504 em ~10% deles. O proxy chamava `getUser()` em TODA
 * requisição — inclusive nas que se autenticam sozinhas logo em seguida:
 *
 *   - prefetch do `<Link>` (o roteador pede o RSC de cada link visível);
 *   - POST de Server Action (header `next-action`);
 *   - avatar de contato e mídia de mensagem — uma lista de 50 conversas são
 *     50 avatares, cada um com o `getUser()` do proxy e o da rota.
 *
 * ─── Por que é seguro ──────────────────────────────────────────────────────
 *
 * Os headers são do cliente, então um atacante os forja à vontade. A dispensa
 * só vale onde o proxy NÃO é a última porta:
 *
 *   - Server Action: o id da ação viaja no header e ela roda em QUALQUER
 *     caminho — inclusive em `/login`, que já é público. O proxy nunca protegeu
 *     ação nenhuma; cada uma chama `loadAuthUser()`/`requireRole()` por dentro.
 *   - Prefetch: só em `/app/*`. Toda page dali chama `loadAuthUser()`/
 *     `requireAuth()` ou é casca de cliente/`redirect` (medido: 60 de 66 pages
 *     se autenticam, as 6 restantes não leem dado nenhum). `/admin/*` fica de
 *     fora de propósito: lá o proxy faz o gate de platform admin.
 *   - Avatar e mídia: as duas rotas abrem com `loadAuthUser()` → 401.
 *
 * ─── A guarda do relógio ───────────────────────────────────────────────────
 *
 * O `getUser()` do proxy também RENOVA a sessão vencida e grava o cookie novo
 * na resposta. Um Server Component não consegue gravar cookie: se o token
 * vencesse numa requisição dispensada, o render renovaria a sessão, perderia o
 * refresh token novo, e a próxima navegação reusaria o antigo — que o GoTrue
 * trata como reuso e pode derrubar a sessão inteira. Por isso a dispensa exige
 * um access token com folga de validade; perto do fim, o caminho é o completo.
 *
 * Ler `expires_at` do cookie NÃO é confiar no cookie: o valor só decide fazer
 * MAIS trabalho (o caminho completo), nunca menos verificação — quem decide
 * acesso continua sendo o `getUser()` de quem vem depois. E não é
 * `getSession()`, que a doutrina proíbe no backend.
 */

/** Margem antes do vencimento em que o proxy volta a renovar a sessão. */
export const FOLGA_DE_VALIDADE_S = 120;

const ROTAS_QUE_SE_AUTENTICAM: RegExp[] = [
  /^\/api\/v1\/contacts\/[^/]+\/avatar$/,
  /^\/api\/v1\/messages\/[^/]+\/media$/,
];

export interface PedidoNoProxy {
  method: string;
  pathname: string;
  header: (nome: string) => string | null;
  /** Valor do cookie pelo nome exato; `undefined` se ausente. */
  cookie: (nome: string) => string | undefined;
}

export type MotivoDaDispensa = "server_action" | "prefetch" | "rota_autenticada";

function ehPrefetch(header: PedidoNoProxy["header"]): boolean {
  if (header("next-router-prefetch")) return true;
  const purpose = header("purpose") ?? header("sec-purpose");
  return !!purpose && purpose.toLowerCase().includes("prefetch");
}

/**
 * Reúne o cookie de sessão do `@supabase/ssr` (inteiro ou em pedaços `.0`,
 * `.1`…) e devolve o `expires_at` (segundos) — `null` se não der para ler.
 */
export function validadeDaSessao(
  cookie: PedidoNoProxy["cookie"],
  nomeDoCookie: string,
): number | null {
  let valor = cookie(nomeDoCookie);
  if (!valor) {
    const pedacos: string[] = [];
    for (let i = 0; ; i++) {
      const pedaco = cookie(`${nomeDoCookie}.${i}`);
      if (!pedaco) break;
      pedacos.push(pedaco);
    }
    valor = pedacos.join("");
  }
  if (!valor) return null;
  try {
    let json = valor;
    if (valor.startsWith("base64-")) {
      const b64 = valor.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    }
    const sessao = JSON.parse(json) as { expires_at?: unknown };
    return typeof sessao.expires_at === "number" ? sessao.expires_at : null;
  } catch {
    return null;
  }
}

/**
 * `null` = o proxy faz o caminho completo (`getUser()`). Um motivo = pode
 * devolver a resposta sem falar com o GoTrue.
 */
export function dispensaDoGetUser(
  pedido: PedidoNoProxy,
  nomeDoCookie: string,
  agoraS: number = Math.floor(Date.now() / 1000),
): MotivoDaDispensa | null {
  let motivo: MotivoDaDispensa | null = null;
  if (pedido.method === "POST" && pedido.header("next-action")) motivo = "server_action";
  else if (ROTAS_QUE_SE_AUTENTICAM.some((r) => r.test(pedido.pathname))) motivo = "rota_autenticada";
  else if (
    pedido.method === "GET" &&
    ehPrefetch(pedido.header) &&
    (pedido.pathname === "/app" || pedido.pathname.startsWith("/app/"))
  ) {
    motivo = "prefetch";
  }
  if (!motivo) return null;

  const expiraEm = validadeDaSessao(pedido.cookie, nomeDoCookie);
  if (expiraEm === null || expiraEm - agoraS <= FOLGA_DE_VALIDADE_S) return null;
  return motivo;
}
