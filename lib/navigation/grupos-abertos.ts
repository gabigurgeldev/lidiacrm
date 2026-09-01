import { NAV_DESTINATIONS, NAV_GROUPS, type NavGroupId } from "@/lib/navigation/registry";

/**
 * Quais grupos do sidebar estão abertos — a regra pura, sem React e sem DOM.
 *
 * O sidebar deixou de mostrar as 20 telas de uma vez: cada grupo recolhe, e a
 * escolha sobrevive ao F5. Onde essa escolha mora é a decisão que importa aqui.
 *
 * ⚠️ COOKIE, E NÃO `localStorage` — e a diferença é visível a olho nu.
 * `localStorage` só existe depois da hidratação, então o servidor não tem como
 * saber o que desenhar: ele pintaria todos os grupos abertos e o navegador os
 * fecharia meio segundo depois, a cada carregamento de página. O cookie chega
 * junto com a requisição, `app/app/layout.tsx` o lê no mesmo `cookies()` que já
 * abre para o `sidebar_collapsed`, e o primeiro pixel já é o certo.
 *
 * Ele é NÃO-httpOnly de propósito: quem escreve é o clique, com `document.cookie`,
 * sem Server Action e sem `revalidatePath`. Recolher um grupo não pode custar
 * uma ida ao servidor. Não guarda nada sensível — é uma lista de nomes de menu.
 */
export const COOKIE_GRUPOS = "nav_grupos_abertos";

/** Um ano, igual ao `sidebar_collapsed`: é preferência, não sessão. */
export const MAX_AGE_GRUPOS = 60 * 60 * 24 * 365;

const IDS_VALIDOS = new Set<string>(NAV_GROUPS.map((g) => g.id));

/**
 * Lê o cookie bruto.
 *
 * `null` e `[]` são estados DIFERENTES e o produto depende disso: `null` é
 * "nunca escolheu" (primeiro acesso — abre o grupo da rota e mais nada), `[]` é
 * "escolheu fechar todos". Um único valor para os dois faria o sidebar de quem
 * fechou tudo reabrir sozinho no próximo login.
 *
 * Ids desconhecidos são descartados em silêncio: um cookie de uma versão que
 * tinha outro grupo não pode derrubar a navegação de quem atualizou.
 */
export function lerGruposAbertos(bruto: string | undefined | null): NavGroupId[] | null {
  if (bruto === undefined || bruto === null) return null;
  return bruto
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is NavGroupId => IDS_VALIDOS.has(p));
}

export function serializarGrupos(abertos: Iterable<NavGroupId>): string {
  return [...new Set(abertos)].join(",");
}

/**
 * O grupo da tela em que se está — casamento pelo href mais LONGO.
 *
 * Prefixo mais longo, e não o primeiro que casa: `/app/settings/tenant/pipelines`
 * começa com `/app/settings`, que é o hub de Organização. Pelo primeiro casamento
 * as Etapas do funil acenderiam Organização em vez de CRM, que é o grupo em que
 * elas moram — o mesmo tipo de confusão que a reorganização veio desfazer.
 */
export interface CandidatoDeRota {
  readonly href: string;
  readonly grupo: NavGroupId;
}

/**
 * A REGRA, separada dos DADOS — e a separação foi paga, não escolhida por gosto.
 *
 * Medido: sabotei `grupoDaRota` para pegar o primeiro casamento em vez do mais
 * longo e a suíte ficou inteira verde. O registro de hoje não distingue as duas
 * regras: em toda rota em que um href é prefixo de outro, o mais longo já vem
 * primeiro no array. A regra certa estava certa por coincidência de ordenação —
 * e uma reordenação do registro (que é um array editado à mão, agrupado por
 * jornada) a quebraria em silêncio.
 *
 * Com a lista como parâmetro, o caso que separa as duas regras pode ser
 * construído no teste em vez de esperado do registro.
 */
export function grupoPorPrefixoMaisLongo(
  pathname: string,
  candidatos: readonly CandidatoDeRota[],
): NavGroupId | null {
  let escolhido: NavGroupId | null = null;
  let tamanho = -1;
  for (const c of candidatos) {
    // `startsWith(href + "/")` e não `startsWith(href)`: sem a barra,
    // `/app/inboxeamento` casaria com `/app/inbox`.
    if (pathname !== c.href && !pathname.startsWith(c.href + "/")) continue;
    if (c.href.length <= tamanho) continue;
    tamanho = c.href.length;
    escolhido = c.grupo;
  }
  return escolhido;
}

/**
 * O grupo da tela em que se está.
 *
 * Prefixo mais longo, e não o primeiro que casa: `/app/settings/tenant/pipelines`
 * começa com `/app/settings`, que é o hub de Organização. Pela regra errada, as
 * Etapas do funil acenderiam Organização em vez de CRM — o mesmo tipo de
 * confusão que a reorganização do menu veio desfazer.
 */
export function grupoDaRota(pathname: string): NavGroupId | null {
  return grupoPorPrefixoMaisLongo(pathname, [
    ...NAV_DESTINATIONS.map((d) => ({ href: d.href, grupo: d.group })),
    ...NAV_GROUPS.flatMap((g) => (g.hub ? [{ href: g.hub.href, grupo: g.id }] : [])),
  ]);
}

/**
 * O conjunto que o primeiro render desenha.
 *
 * O grupo da rota atual entra SEMPRE, inclusive por cima do cookie. É a regra
 * que garante uma coisa simples: o item aceso é visível. Sem ela, quem fechasse
 * Canais e depois abrisse um link direto para /app/webhooks veria uma barra sem
 * nenhuma marca de onde está — e o único jeito de descobrir seria abrir grupo
 * por grupo até achar o item aceso.
 *
 * Fechar o grupo da página em que se está continua funcionando dentro da
 * sessão; ele volta no próximo carregamento, porque é onde a pessoa está.
 */
export function gruposIniciais(
  salvos: NavGroupId[] | null,
  pathname: string,
): Set<NavGroupId> {
  const abertos = new Set<NavGroupId>(salvos ?? []);
  const daRota = grupoDaRota(pathname);
  if (daRota) abertos.add(daRota);
  return abertos;
}

/**
 * Grava a escolha no documento. Separado da regra acima para que ela siga
 * testável sem DOM — e para haver UM lugar que conhece o formato do cookie.
 */
export function gravarGruposAbertos(abertos: Iterable<NavGroupId>): void {
  if (typeof document === "undefined") return;
  const valor = encodeURIComponent(serializarGrupos(abertos));
  // `Lax` e não `Strict`: `Strict` some quando se chega ao app por um link de
  // fora (e-mail de convite, aviso de campanha), e a barra apareceria com o
  // arranjo de fábrica justamente na volta de quem já a tinha arrumado.
  document.cookie = `${COOKIE_GRUPOS}=${valor}; path=/; max-age=${MAX_AGE_GRUPOS}; samesite=lax`;
}
