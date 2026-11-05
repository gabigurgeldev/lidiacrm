/**
 * Supabase client para Client Components (browser).
 *
 * Use este em qualquer arquivo com "use client". NUNCA em Server Components,
 * Route Handlers, ou middleware — eles devem usar `lib/supabase/server.ts`.
 *
 * Sessão persiste via cookie SameSite=Strict gerenciado pelo @supabase/ssr.
 */

import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * QUEM DIZ AO SOCKET DO REALTIME QUAL É O TOKEN.
 *
 * O cookie de sessão é httpOnly (CLAUDE.md), então o supabase-js do browser não
 * enxerga a sessão — `auth.getSession()` devolve null. A callback PADRÃO do
 * supabase-js nesse caso é `_getAccessToken()`, e ela termina em
 * `?? this.supabaseKey`: **o socket assina com a anon key**. Canal anônimo
 * responde SUBSCRIBED, a RLS filtra do outro lado, e nada é entregue — morte
 * silenciosa, porque todo sinal disponível diz "saudável".
 *
 * ⚠️ POR QUE AQUI E NÃO EM `setAuth()`, QUE ERA A CORREÇÃO ANTERIOR. O repo
 * corrigia isto chamando `supabase.realtime.setAuth(token)` antes de assinar.
 * Isso PAROU DE FUNCIONAR num bump de dependência, sem uma linha de código
 * nossa mudar: a partir do realtime-js 2.112.x a callback passou a vencer o
 * token manual, o que a própria biblioteca documenta em `setAuth` —
 *
 *   "the callback is the source of truth: the client remains in callback mode
 *    and continues to refresh from it on heartbeat, even after a
 *    bootstrap/override `setAuth(token)` call"
 *
 * — e o `_manuallySetToken` que protegia o token manual virou sempre `false`,
 * porque o SupabaseClient SEMPRE instala uma callback. Medido: o token do
 * usuário sobrevivia ~2ms ao `setAuth`, e o heartbeat seguinte (~30s) o
 * substituía pela anon key de qualquer forma.
 *
 * Substituir a callback é a via suportada, e ela é melhor que o `setAuth` por
 * uma razão que independe do bug: o socket a chama de novo a cada heartbeat e
 * em cada reconexão. Um token de 1h deixa de ser uma bomba-relógio — quem
 * ficava com o inbox aberto por mais de uma hora perdia o tempo real e nada
 * avisava.
 *
 * `settings.realtime` sobrescreve a callback padrão porque entra depois no
 * spread do SupabaseClient (`_initRealtimeClient({...defaults}, settings.realtime)`),
 * e `accessToken` é opção pública de `RealtimeClientOptions`. Não tocamos em
 * `supabase.auth`: passar `accessToken` no nível do CLIENT (e não do realtime)
 * transformaria `.auth` num Proxy que lança.
 */
const MARGEM_DE_RENOVACAO_MS = 60_000;

let tokenEmCache: { valor: string; expiraEm: number } | null = null;
let buscaEmVoo: Promise<string | null> | null = null;

/** Só para teste: zera o cache do token (é módulo-global de propósito). */
export function __resetTokenDoRealtime(): void {
  tokenEmCache = null;
  buscaEmVoo = null;
}

/**
 * A callback que o socket consulta. NUNCA devolve vazio — ou tem token do
 * usuário, ou LANÇA.
 *
 * ⚠️ POR QUE LANÇAR E NÃO DEVOLVER `null`. O realtime-js trata os dois de forma
 * oposta (`RealtimeClient._performAuth`):
 *
 *   - `null` é um token NOVO. Ele grava `null`, reescreve o join de todo canal
 *     e empurra `access_token: null` aos canais já de pé. Join sem token sai
 *     com a anon key: o canal vira ANÔNIMO.
 *   - exceção é falha da callback. Ele registra e segue com o token que já
 *     tinha, sem tocar em canal nenhum.
 *
 * Medido em produção: com a CPU saturada, a busca deste token estourou o tempo,
 * a callback devolveu `null` no heartbeat e os canais de uma aba viraram
 * anônimos. A policy de `conversations` chama uma função que anon não pode
 * executar, então o `realtime.list_changes` passou a falhar para TODAS as
 * organizações — e a aba entrou em laço de reassinar e reler o inbox inteiro,
 * ~1×/s, sobre a mesma VPS que já estava sem CPU.
 *
 * Lançar também não serve no PRIMEIRO join, quando o socket ainda não tem
 * token nenhum para manter: o join sairia vazio do mesmo jeito. Quem cobre
 * esse caso é `socketTemTokenDoUsuario`, que o hook do canal consulta antes de
 * assinar.
 */
async function tokenDoRealtime(): Promise<string> {
  // Válido e longe de expirar: serve o cache. Sem isto seria uma requisição a
  // cada heartbeat — ~2/min por aba aberta, para um token que vale uma hora.
  if (tokenEmCache && Date.now() < tokenEmCache.expiraEm - MARGEM_DE_RENOVACAO_MS) {
    return tokenEmCache.valor;
  }
  const novo = await buscarTokenDoRealtime();
  if (novo) return novo;
  // A renovação falhou, mas o token que temos pode ainda não ter vencido — a
  // margem existe para renovar ANTES, não para jogar fora um token válido.
  if (tokenEmCache && Date.now() < tokenEmCache.expiraEm) return tokenEmCache.valor;
  throw new Error("realtime_token_indisponivel");
}

function buscarTokenDoRealtime(): Promise<string | null> {
  // Coalesce: N canais assinando juntos fazem UMA requisição, não N.
  buscaEmVoo ??= (async () => {
    try {
      const res = await fetch("/api/v1/auth/realtime-token", { credentials: "include" });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { access_token?: string; expires_at?: number | null };
      };
      const token = body.data?.access_token;
      if (!token) return null;
      // `expires_at` é epoch em SEGUNDOS. Sem ele, trata como já vencido na
      // próxima pergunta: revalidar de graça é melhor que servir token morto.
      const expiraEm = body.data?.expires_at ? body.data.expires_at * 1000 : 0;
      tokenEmCache = { valor: token, expiraEm };
      return token;
    } catch {
      // `null` aqui é só "esta busca falhou". Quem decide o que o socket
      // recebe é `tokenDoRealtime`, que nunca repassa o vazio — ver acima.
      return null;
    } finally {
      // ⚠️ NUNCA memoizar a promessa além da requisição: uma falha transitória
      // (sessão estabelecendo, cookie em renovação) condenaria o carregamento
      // inteiro a canais anônimos. O que se guarda é o token BOM, com prazo;
      // o que não se guarda é a falha. O critério não é "deu erro?" — é "o
      // resultado guardado é o resultado DESEJADO?".
      buscaEmVoo = null;
    }
  })();
  return buscaEmVoo;
}

/**
 * O SOCKET JÁ TEM O TOKEN DO USUÁRIO? Pergunta que o hook do canal faz antes de
 * cada assinatura.
 *
 * O join leva o token que o socket tem NAQUELE instante
 * (`RealtimeChannel.subscribe` lê `socket.accessTokenValue`). Sem nenhum, sai
 * com a anon key — e lançar na callback não evita isso, porque não há token
 * anterior para manter. Assinar assim é pior que não assinar: o canal responde
 * SUBSCRIBED, não entrega nada, e numa tabela cuja policy chama função que anon
 * não executa ainda envenena o Realtime das outras organizações.
 *
 * `setAuth()` SEM argumento não é token manual: ele só manda o socket consultar
 * a callback acima, que segue sendo a fonte única. Passar um token ali é que
 * seria a segunda fonte — a que o realtime-js 2.112.x passou a ignorar.
 */
export async function socketTemTokenDoUsuario(
  client: ReturnType<typeof createBrowserClient>,
): Promise<boolean> {
  if (client.realtime.accessTokenValue) return true;
  await client.realtime.setAuth();
  return Boolean(client.realtime.accessTokenValue);
}

export function createClient() {
  // Singleton no browser pra reaproveitar canais Realtime e auth state.
  if (_client) return _client;

  // Self-host (imagem genérica): valores injetados em runtime pelo
  // <PublicEnvScript/>. Vercel/dev: fallback pro process.env.NEXT_PUBLIC_*
  // (baked em build). Ler a URL do Supabase daqui é o que permite uma única
  // imagem servir qualquer projeto Supabase sem rebuild.
  const runtime =
    typeof window !== "undefined" ? window.__PUBLIC_ENV__ : undefined;
  const url = runtime?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    runtime?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "[supabase/browser] NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.",
    );
  }

  _client = createBrowserClient(url, key, {
    // D-01.01: cookie name canônico alinhado ao middleware/server.
    cookieOptions: {
      name: "sb-deskcomm-auth",
      sameSite: "strict",
      path: "/",
    },
    realtime: { accessToken: tokenDoRealtime },
  });
  return _client;
}
