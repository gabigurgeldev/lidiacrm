import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { DEFAULT_APP_NAME } from "@/lib/branding";
import { letraDoIcone } from "@/lib/branding/icone";
import { LOGO_PADRAO_DO_PRODUTO, SIMBOLO_PADRAO_DO_PRODUTO } from "@/lib/branding/resolve";
import { marcaDaSaida } from "@/lib/branding/saida";
import { logger } from "@/lib/logger";

/**
 * O ícone da aba, DESENHADO em runtime com a marca da instalação.
 *
 * ─── O que existia antes: nada ──────────────────────────────────────────────
 *
 * Zero `app/icon.*`, zero `app/favicon.ico`, zero `public/favicon*` (medido:
 * `public/` tem dois arquivos, `.gitkeep` e `llms.txt`). O navegador pedia
 * `/favicon.ico` por conta própria e recebia 404 — em produção, 19.435 bytes,
 * porque o 404 é a `app/not-found.tsx` INTEIRA servida para um pedido de
 * ícone. Na prática: aba sem marca nenhuma, para nós e para todo revendedor.
 *
 * ─── Por que GERADO, e não um arquivo em `public/` ──────────────────────────
 *
 * `Dockerfile:75-79` copia `public/` para a imagem final, e a imagem é UMA SÓ
 * para todas as marcas — a mesma tag do GHCR que cada clone puxa. Um
 * `favicon.ico` estático resolveria o 404 e entregaria a NOSSA marca na aba de
 * todo revendedor, que é o mesmo modo de falha que `lib/branding.ts:12-16`
 * documenta para `NEXT_PUBLIC_*`: verde em dev, verde no CI, verde na Vercel, e
 * errado exatamente na VPS de quem a feature existe para servir.
 *
 * ─── Sem marca configurada, a aba mostra o SÍMBOLO do produto ───────────────
 *
 * O disco "GC" (`public/gestalt-crm-simbolo.png`), servido como está — os
 * mesmos bytes que a barra recolhida desenha, então aba e barra mostram a mesma
 * coisa em vez de duas representações da mesma marca.
 *
 * ⚠️ ISTO NÃO REABRE O PARÁGRAFO ABAIXO. O que ele proíbe é buscar o
 * `logo_url`, que é `text` livre digitado pelo operador; o que se lê aqui é um
 * arquivo NOSSO, de dentro da própria imagem, com caminho constante. Não há
 * rede, não há entrada de usuário no caminho, e a leitura só acontece quando
 * ninguém configurou marca nenhuma — havendo qualquer marca, o desenho abaixo
 * continua sendo o único caminho.
 *
 * E a leitura de disco pode falhar (imagem montada estranho, arquivo removido
 * por engano). Falhando, ela cai no ladrilho desenhado em vez de devolver 500:
 * o ícone da aba não é lugar de derrubar página.
 *
 * ─── Cor + inicial, NUNCA o `logo_url` ──────────────────────────────────────
 *
 * `platform_branding.logo_url` é `text` livre, sem CHECK de host
 * (`supabase/baseline.sql:11832-11848`). Buscá-la aqui seria uma requisição de
 * saída disparada pelo `<head>` de TODA página, com a URL vinda de um campo que
 * o operador digita — SSRF com gatilho em cada page load. Derivar o ícone de
 * cor + inicial não toca a rede: o accent vem do mesmo resolvedor que pinta os
 * e-mails (`marcaDaSaida`) e a fonte (`Geist-Regular.ttf`) vem embutida no
 * `@vercel/og` que o Next já traz — nenhuma dependência nova, nenhum download.
 *
 * ─── `force-dynamic` não é zelo ─────────────────────────────────────────────
 *
 * O loader de metadata NÃO injeta `force-static` na variante gerada por código
 * (`next-metadata-route-loader.js`, `getSingleImageRouteCode`), mas também não
 * a torna dinâmica sozinha — sem esta linha o `next build` congelaria o ícone
 * dentro da imagem pré-buildada, com a marca de quem buildou. E o defeito seria
 * invisível em dev, em teste e na Vercel: só apareceria na VPS do revendedor,
 * que é o único lugar onde a marca é outra. O loader re-exporta todo named
 * export do arquivo do usuário (`:43`), então declarar aqui basta.
 *
 * ─── Custo ──────────────────────────────────────────────────────────────────
 *
 * Um `ImageResponse` por requisição a `/icon`. O `Cache-Control` abaixo é o que
 * mantém isso em uma renderização por minuto por navegador em vez de uma por
 * navegação. A leitura da marca é a MESMA que o `generateMetadata` do layout já
 * faz, memoizada por 30s (`lib/branding/instalacao.ts:209`) — nenhuma consulta
 * a mais no banco.
 *
 * ⚠️ `/icon` precisa estar em `PUBLIC_PATHS` (`lib/auth/public-paths.ts`): o
 * matcher do `proxy.ts:128` só dispensa caminho COM extensão, e `/icon` não tem
 * — sem a entrada, o ícone responde 307 para `/login` a quem ainda não entrou,
 * que é exatamente a primeira tela que um comprador vê.
 */

export const dynamic = "force-dynamic";

/** 64 e não 32: a aba pede 16-32 CSS px, e em tela retina isso são 32-64 reais. */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** O mesmo `cache-control` para os dois caminhos — ver o comentário embaixo. */
const CACHE = "public, max-age=60, stale-while-revalidate=600";

/**
 * NADA FOI CONFIGURADO — nem nome, nem logo. Mesma pergunta que
 * `SidebarBrand` faz, e pelo mesmo motivo: marca configurada, ainda que só o
 * nome, é marca de outra pessoa, e a aba dela não leva o nosso disco.
 */
function ehMarcaDoProduto(marca: { nome: string; logoUrl: string | null }): boolean {
  return (
    marca.nome === DEFAULT_APP_NAME &&
    (!marca.logoUrl || marca.logoUrl === LOGO_PADRAO_DO_PRODUTO)
  );
}

export default async function Icon() {
  const marca = await marcaDaSaida(null);

  if (ehMarcaDoProduto(marca)) {
    try {
      const bytes = await readFile(
        // `process.cwd()` + `public/`: é onde o `Dockerfile` põe a pasta na
        // imagem final, e onde ela está em dev. O nome do arquivo vem da MESMA
        // constante que a barra usa no `src` — duas cópias da string dariam um
        // 404 silencioso num dos dois lugares no dia em que a arte mudasse.
        path.join(process.cwd(), "public", SIMBOLO_PADRAO_DO_PRODUTO.replace(/^\//, "")),
      );
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": contentType, "cache-control": CACHE },
      });
    } catch (erro) {
      // Sem `throw`: a alternativa a um ícone é uma aba sem ícone, não um 500
      // em toda página. O desenho abaixo é um fallback completo e correto.
      logger.warn("ícone da aba: não deu para ler o símbolo do produto; vale o ladrilho", {
        detalhe: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  const letra = letraDoIcone(marca.nome);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: marca.accent,
          color: marca.accentFg,
          // 62% da altura: a caixa maiúscula do Geist ocupa ~72% do em, então
          // a letra fica com respiro sem virar um selo minúsculo no meio.
          fontSize: Math.round(size.height * 0.62),
          // O ladrilho é quadrado e cheio: o navegador já arredonda o favicon
          // no chrome dele, e arredondar aqui também produz canto duplo.
          borderRadius: 0,
        }}
      >
        {letra ?? ""}
      </div>
    ),
    {
      ...size,
      headers: {
        // 60s é deliberado, e o par com o TTL da marca: o operador que troca a
        // cor em `/admin/marca` vê a aba acompanhar dentro de um minuto. Um
        // `immutable` de um ano tornaria a tela de marca uma promessa que o
        // ícone não cumpre; `no-store` faria o satori rodar a cada navegação.
        //
        // O caminho do símbolo usa o MESMO valor: o operador que configura a
        // marca própria vê a aba trocar de disco para ladrilho no mesmo minuto.
        "cache-control": CACHE,
      },
    },
  );
}
