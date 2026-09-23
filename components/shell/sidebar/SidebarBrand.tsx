"use client";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { DEFAULT_APP_NAME } from "@/lib/branding";
import { letraDoIcone } from "@/lib/branding/icone";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import {
  LOGO_PADRAO_DO_PRODUTO,
  LOGO_PADRAO_EM_FUNDO_ESCURO,
  SIMBOLO_PADRAO_DO_PRODUTO,
} from "@/lib/branding/resolve";
import { cn } from "@/lib/utils";

/**
 * O topo da barra: a marca de quem hospeda, com o nome da organização por cima.
 *
 * ── O SÍMBOLO mora no DOM sempre, e quem escolhe entre ele e o wordmark é o CSS
 *
 * ⚠️ ISTO MUDOU. Antes, a decisão de compacto era de JAVASCRIPT aqui — era o
 * único pedaço da barra assim — e o preço era um caso sem dono: entre 768 e
 * 1023px a barra tem 72px e o cookie continua dizendo "expandida", então o
 * `<img>` de uma arte ~6,9:1 era RECORTADO por `object-fit: cover` para caber.
 * Recorte serve qualquer arte e não fica bom em nenhuma.
 *
 * Agora o wordmark e o símbolo são irmãos no DOM e as MESMAS regras de barra
 * estreita que escondem `.nav-rotulo` escondem um ou outro (`app/globals.css`,
 * bloco "O que some quando a barra é estreita"). O tablet ganha o símbolo
 * inteiro em vez de uma tira de 6px, e não existe mais um terceiro caminho que
 * só o CSS conhece.
 *
 * O que as quatro asserções de `sidebar-nome-da-organizacao.test.tsx` medem
 * continua valendo, e é o que limita este arquivo: há **um** `<img>` (nunca
 * dois) e, havendo logo, o NOME não é escrito em lugar nenhum — o cabeçalho tem
 * 56px de altura para um dos dois. O símbolo não é nome nem imagem: é uma letra.
 *
 * ── Recolhida, a marca do PRODUTO é o símbolo; a de um revendedor é a letra
 *
 * Sem marca configurada, o ladrilho é o disco "GC"
 * (`SIMBOLO_PADRAO_DO_PRODUTO`) — a barra estreita mostra a MARCA, não um
 * caractere que a representa. A condição inteira está no `marcaEhDoProduto`,
 * abaixo, e existe porque a imagem Docker é uma só para todas as marcas.
 *
 * ── A letra vem de `letraDoIcone`, a mesma do ícone da aba
 *
 * Não é `[...nome][0]`: aquele devolve o EMOJI quando a marca começa com um, e
 * `letraDoIcone` devolve a primeira LETRA OU DÍGITO — a mesma regra que
 * `app/icon.tsx` usa para desenhar o favicon. Assim a barra recolhida e a aba
 * do navegador mostram o mesmo caractere, que é o que faz as duas parecerem a
 * mesma marca. Marca só de emoji devolve `null` e o ladrilho fica só com a cor.
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
 *
 * ── SEM BORDA EMBAIXO, e isso é decisão de desenho, não esquecimento
 *
 * O `border-b` daqui desenhava um risco de ponta a ponta entre a marca e o
 * primeiro grupo. Ele não separava nada: a barra inteira é UMA superfície
 * (o `.casca-moldura` do `AppShell` pinta barra e cabeçalho juntos), e o que
 * delimita o topo já é a altura de 56px mais o respiro do `<nav>`. Numa
 * coluna que também tinha o filete de aninhamento dos grupos, era o segundo
 * risco decorativo da mesma tela — os dois saíram na mesma onda.
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
  const logoConfigurado = activeOrg?.marca?.logoUrl || brand.logoUrl;

  /**
   * A barra é ESCURA, e o logo do produto tem uma arte própria para isso.
   *
   * ⚠️ Medido na tela: a palavra "Gestalt" é quase preta. Sobre a moldura preta
   * ela some e sobra um "CRM" verde solto — e a arte branca tem o defeito
   * espelhado na tela de login, que é clara. Uma arte não serve as duas
   * superfícies, então quem sabe em qual delas está é quem escolhe.
   *
   * A troca vale SÓ para o logo do produto. Se a instalação configurou a
   * própria arte, ela aparece como foi enviada — mostrar a nossa versão branca
   * no lugar seria pôr a NOSSA marca dentro do produto de quem hospeda.
   */
  const logo =
    logoConfigurado === LOGO_PADRAO_DO_PRODUTO ? LOGO_PADRAO_EM_FUNDO_ESCURO : logoConfigurado;

  /**
   * O ladrilho da marca — a mesma peça que `app/icon.tsx` desenha na aba.
   *
   * `aria-hidden` porque ele não acrescenta informação: quando há logo, o `alt`
   * da imagem já diz o nome; quando não há, o `<span>` do nome está do lado.
   * Um leitor de tela anunciando "G" antes do nome seria ruído.
   */
  /**
   * NADA FOI CONFIGURADO — nem nome, nem logo. É a instalação do produto.
   *
   * ⚠️ A pergunta é essa, e não "o logo em vigor é o nosso?". Um revendedor
   * pode ter posto só o NOME, sem logo, e nesse caso o logo em vigor ainda é o
   * nosso — mas a marca em vigor é a dele, e mostrar o disco "GC" seria pôr a
   * NOSSA marca dentro do produto dele. A imagem Docker é uma só para todas as
   * marcas; é sempre este o modo de falha que uma condição de marca previne.
   */
  const marcaEhDoProduto =
    nome === DEFAULT_APP_NAME &&
    (!logoConfigurado || logoConfigurado === LOGO_PADRAO_DO_PRODUTO);

  /**
   * O que sobra do topo quando a barra é estreita.
   *
   * Sendo o produto, é o SÍMBOLO: o disco "GC", a mesma marca que a arte larga
   * carrega à esquerda da palavra — a barra recolhida passa a mostrar a marca,
   * e não uma letra que a representa. Sendo uma marca configurada, é o ladrilho
   * com a inicial dela, porque a arte que um revendedor envia tem proporção
   * desconhecida e quase sempre é uma faixa: espremê-la em 32px devolve uma
   * tira ilegível. A letra vem de `letraDoIcone`, a mesma de `app/icon.tsx`.
   *
   * ⚠️ OS DOIS CARREGAM A CLASSE `nav-marca-simbolo`, e isso é deliberado: é
   * ela que as regras de barra estreita alternam contra `.nav-logo`. Um nome de
   * classe novo obrigaria a duplicar quatro seletores no globals.css, e no dia
   * em que alguém atualizasse só um deles a barra ficaria sem marca nenhuma no
   * recolhido, em silêncio.
   *
   * `aria-hidden` nos dois porque não acrescentam informação: havendo logo, o
   * `alt` da imagem já diz o nome; não havendo, o `<span>` do nome está do
   * lado. Um leitor de tela anunciando "G" antes do nome seria ruído.
   */
  const simbolo = marcaEhDoProduto ? (
    /* `<img>` cru e não `next/image`, pelo mesmo motivo do wordmark abaixo: a
       imagem é pré-buildada e o otimizador exige allowlist fechada em build. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={SIMBOLO_PADRAO_DO_PRODUTO}
      alt=""
      aria-hidden
      className="nav-marca-simbolo nav-marca-simbolo-arte"
    />
  ) : (
    <span aria-hidden className="nav-marca-simbolo">
      {letraDoIcone(nome) ?? ""}
    </span>
  );

  return (
    <div
      className={cn(
        "nav-marca flex h-14 shrink-0 items-center gap-2.5 px-4",
        collapsed && "justify-center px-0",
      )}
    >
      {logo ? (
        <>
          {/* <img> em vez de next/image de propósito: a URL vem de quem hospeda
              (banco ou .env), e next/image exige allowlist de domínios fechada
              em build — a imagem pré-buildada rejeitaria o domínio do
              self-hoster. Altura fixa e largura livre porque a arte enviada tem
              proporção desconhecida; forçar as duas distorceria o logo de quem
              configurou.

              O logo SUBSTITUI o nome, e não convive com ele: a arte que o
              revendedor envia quase sempre já traz o nome escrito.

              `h-6` (24px) e não `h-8`: com a proporção ~6,9:1 do produto, 32px
              rendiam ~223px de largura dentro de uma barra de 264px, e a marca
              virava a coisa mais pesada da tela. 24px dão ~166px e devolvem o
              peso visual para a navegação, que é para onde se olha. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={nome} className="nav-logo h-6 w-auto object-contain" />
          {simbolo}
        </>
      ) : (
        <>
          {simbolo}
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
