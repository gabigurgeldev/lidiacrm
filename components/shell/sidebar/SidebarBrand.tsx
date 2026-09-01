"use client";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { cn } from "@/lib/utils";

/**
 * O topo da barra: a marca de quem hospeda, com o nome da organização por cima.
 *
 * ⚠️ ESTE É O ÚNICO PEDAÇO DA BARRA QUE AINDA DECIDE COMPACTO EM JAVASCRIPT, e
 * é de propósito. Todo o resto do sidebar esconde rótulo por CSS — o que permite
 * o tablet compactar sem tocar no cookie do laptop. Aqui não dá: com logo, a
 * barra desenha a IMAGEM NO LUGAR do nome, e recolhida troca a imagem pela
 * INICIAL. São três nós diferentes para três estados, não um nó que encolhe.
 * Fazê-lo por CSS exigiria os três no DOM ao mesmo tempo, e aí a barra passaria
 * a ter dois `<img>` e um nome invisível — quatro asserções de
 * `sidebar-nome-da-organizacao.test.tsx` medem exatamente a AUSÊNCIA disso.
 *
 * Entre 768 e 1023 a barra é estreita sem que o cookie saiba: lá o logo é
 * limitado por `@media` a 40px de largura, e o nome some pela mesma regra.
 *
 * O CONSUMIDOR do nome por organização. Sem ele, `settings.branding.app_name`
 * seria campo decorativo: medido, o nome da org não aparece em lugar nenhum da
 * casca para o cliente típico de um revendedor — o único leitor é o
 * `TenantSwitcher`, e ele devolve `null` com uma organização só.
 *
 * A marca vem por PROP do servidor (`useMarcaDaInstalacao`), pela mesma rota de
 * `activeOrg`. Era `branding()`, que no navegador lê `window.__PUBLIC_ENV__` e
 * no servidor lê `process.env` — fontes que divergiram quando o layout raiz
 * passou a injetar a marca do BANCO, e a divergência era React #418 em toda
 * tela: o servidor desenhava o `<span>` e o cliente desenhava o `<img>`.
 */
export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const brand = useMarcaDaInstalacao();
  const { activeOrg } = useAuth();

  const nome = activeOrg?.marca?.nome ?? brand.name;
  /**
   * `||` e não `??`: vazio é AUSÊNCIA de logo, não "logo em branco". É a regra
   * que `resolveBranding` e `primeiroDefinido` já aplicam nas camadas de baixo, e
   * com `??` um `""` vindo de cima apagaria o logo do revendedor em vez de
   * descer para ele — que é o contrário do que a precedência por campo promete.
   */
  const logo = activeOrg?.marca?.logoUrl || brand.logoUrl;

  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center gap-2.5 border-b px-4",
        collapsed && "justify-center px-0",
      )}
    >
      {logo && !collapsed ? (
        // <img> em vez de next/image de propósito: a URL vem de quem hospeda
        // (banco ou .env), e next/image exige allowlist de domínios fechada em
        // build — a imagem pré-buildada rejeitaria o domínio do self-hoster.
        // Altura fixa e largura livre porque a arte enviada tem proporção
        // desconhecida; forçar as duas distorceria o logo de quem configurou.
        //
        // O logo SUBSTITUI o nome, e não convive com ele: a arte que o
        // revendedor envia quase sempre já traz o nome escrito, e o cabeçalho
        // tem 56px de altura para um dos dois.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={nome} className="nav-logo h-7 w-auto object-contain" />
      ) : (
        <>
          {/* O SÍMBOLO — a inicial num quadrado, presente nos dois estados.
              Ele existe para a barra estreita, onde é a única coisa que sobra
              do topo; mantê-lo também na expandida é o que dá ao cabeçalho um
              ponto de ancoragem em vez de uma linha de texto solta. */}
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-accent"
            style={{
              // Token, nunca hex: a accent é trocada em runtime pelo revendedor,
              // e um verde literal aqui pintaria de verde a instalação vendida
              // em azul. `color-mix` porque não existe token para "accent a 16%".
              backgroundColor: "color-mix(in oklab, var(--color-accent) 16%, transparent)",
            }}
          >
            {/* Spread e não `[0]`: nome começando com emoji ou acento composto
                quebraria no meio do code point. Mesma regra de `resolveBranding`
                — a inicial precisa acompanhar o nome que a barra mostra, senão
                recolher o menu troca a marca. */}
            {[...nome][0]?.toUpperCase() ?? brand.initial}
          </span>
          <span
            className={cn(
              "nav-marca-nome truncate text-[15px] font-semibold tracking-[-0.015em] text-text",
              collapsed && "sr-only",
            )}
          >
            {nome}
          </span>
        </>
      )}
    </div>
  );
}
