/**
 * Gera o SÍMBOLO do produto — o "GC" redondo — a partir da arte crua.
 *
 * ═══ Onde ele aparece ═══
 *
 *  1. no topo da barra lateral quando ela está ESTREITA, no lugar do ladrilho
 *     com a inicial (`components/shell/sidebar/SidebarBrand.tsx`);
 *  2. no ícone da aba (`app/icon.tsx`).
 *
 * Nos DOIS, só quando a instalação não configurou marca própria. Revendedor com
 * nome ou logo dele continua vendo o ladrilho da inicial dele — a imagem Docker
 * é UMA para todas as marcas, e servir este arquivo incondicionalmente poria a
 * NOSSA marca dentro do produto de quem hospeda.
 *
 * ═══ Por que não servir a arte crua ═══
 *
 * Ela tem 549 KB, 1256x1256, e mais de metade da área é ar transparente. O
 * `Dockerfile` copia `public/` inteiro para a imagem de todo self-hoster, e o
 * destino dela na tela é uma caixa de 32px. Recortada e reamostrada para 128,
 * o arquivo cai para a casa dos 10 KB — e 128 (4x o alvo) cobre tela retina e o
 * favicon de 64.
 *
 * ═══ O que este script NÃO faz ═══
 *
 * Não troca cor nenhuma. O símbolo já nasce legível sobre a moldura escura E
 * sobre branco (o miolo é preto, o anel é verde), então não há o par
 * claro/escuro que `gerar-logo-gestalt.ts` precisa manter.
 *
 * Uso:  pnpm tsx scripts/gerar-simbolo-gestalt.ts
 */

import path from "node:path";

import { caixaDaArte, escreverPng, lerPng, reamostrar } from "./lib/png";

const RAIZ = process.cwd();

/**
 * A arte crua mora FORA de `public/` — o `.gitignore` cobre `assets-fonte/`.
 * Mesma decisão de `gerar-logo-gestalt.ts`: deixá-la em `public/` serviria meio
 * megabyte de PNG não recortado pela web, ao lado da versão que o produto usa.
 */
const ORIGEM = path.join(RAIZ, "assets-fonte", "logo", "gestalt-simbolo.png");
const DESTINO = path.join(RAIZ, "public", "gestalt-crm-simbolo.png");
const LADO = 128;

/**
 * Esta arte tem HALO: um brilho de alfa baixíssimo que se estende muito além do
 * disco. Medido no arquivo — contando qualquer opacidade, a caixa dá 1175x1052;
 * a partir de alfa 8, dá 832x820, que é o disco. Sem o limiar, o quadrado final
 * ganha ~340px de margem de um lado só e o símbolo sai encostado num canto.
 */
const LIMIAR_DE_ALFA = 8;

function main(): void {
  const original = lerPng(ORIGEM);
  console.log(`origem: ${original.largura}x${original.altura} (arquivo inteiro)`);

  const caixa = caixaDaArte(original, LIMIAR_DE_ALFA);
  const arte = recortarQuadrado(original, caixa);
  console.log(
    `caixa da arte: x ${caixa.x0}→${caixa.x1}, y ${caixa.y0}→${caixa.y1}` +
      `  ⇒  quadrado de ${arte.largura}px`,
  );

  const simbolo = reamostrar(arte, LADO);
  escreverPng(DESTINO, simbolo);
  console.log(`escrito: public/gestalt-crm-simbolo.png  ${LADO}x${LADO}`);

  // ─── A prova ───────────────────────────────────────────────────────────
  // Relemos do DISCO. Sem isto o script "funciona" sem evidência: um bug no
  // codificador sairia como um arquivo de tamanho plausível que o navegador
  // desenha errado.
  const conferido = lerPng(DESTINO);
  if (conferido.largura !== LADO || conferido.altura !== LADO) {
    throw new Error(`releitura deu ${conferido.largura}x${conferido.altura}, esperava ${LADO}²`);
  }
  // O anel verde é o que identifica o símbolo. Se a reamostragem o tivesse
  // comido — ou se a auréola do alfa não-premultiplicado tivesse voltado —,
  // esta contagem cairia para perto de zero e o arquivo passaria assim mesmo.
  let verdes = 0;
  let opacos = 0;
  for (let i = 0; i < conferido.px.length; i += 4) {
    if (conferido.px[i + 3]! < 0x80) continue;
    opacos += 1;
    const [r, g, b] = [conferido.px[i]!, conferido.px[i + 1]!, conferido.px[i + 2]!];
    if (g - Math.max(r, b) > 24) verdes += 1;
  }
  const fracao = verdes / opacos;
  if (fracao < 0.05) {
    throw new Error(
      `só ${(fracao * 100).toFixed(1)}% dos pixels opacos são verdes — o anel da marca sumiu`,
    );
  }
  console.log(
    `conferido: ${opacos} pixels opacos, ${verdes} verdes (${(fracao * 100).toFixed(1)}%)`,
  );
}

/**
 * Recorta a caixa da arte e a completa até ficar QUADRADA, centralizada.
 *
 * O símbolo é um disco, então a caixa útil já sai quase quadrada — mas "quase"
 * vira distorção quando o destino é 128x128 fixo. Completar com transparência
 * preserva a circunferência; esticar para o quadrado daria uma elipse, e o
 * olho pega isso num logo redondo.
 */
function recortarQuadrado(
  img: { largura: number; altura: number; px: Buffer },
  c: { x0: number; y0: number; x1: number; y1: number },
) {
  const largura = c.x1 - c.x0 + 1;
  const altura = c.y1 - c.y0 + 1;
  const lado = Math.max(largura, altura);
  const px = Buffer.alloc(lado * lado * 4);
  const deslocaX = Math.floor((lado - largura) / 2);
  const deslocaY = Math.floor((lado - altura) / 2);
  for (let y = 0; y < altura; y += 1) {
    const origem = (y + c.y0) * img.largura * 4 + c.x0 * 4;
    img.px.copy(px, ((y + deslocaY) * lado + deslocaX) * 4, origem, origem + largura * 4);
  }
  return { largura: lado, altura: lado, px };
}

main();
