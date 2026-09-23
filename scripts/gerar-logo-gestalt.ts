/**
 * Gera os arquivos de logo do produto a partir da arte crua.
 *
 * ═══ Por que este script existe, e por que ele não é "abra no Photoshop" ═══
 *
 * A arte que chegou (`public/Design sem nome (2).png`) tem dois problemas que
 * só aparecem quando ela encontra a casca escura, e os dois são MEDIDOS, não
 * de gosto:
 *
 *  1. **58% da altura do arquivo é ar transparente.** A arte ocupa 2046x294
 *     dentro de um quadro de 2172x724 — 206px de vazio em cima, 224px embaixo.
 *     Um `<img class="h-7">` dimensiona o QUADRO, então a logo aparecia com
 *     ~11px de altura visível e parecia minúscula sem que nada no CSS
 *     explicasse por quê.
 *  2. **A palavra "Gestalt" é #171717.** Sobre a barra preta ela simplesmente
 *     some, e sobra um "CRM" verde solto.
 *
 * Um recorte manual resolveria hoje e apodreceria na próxima arte. Este script
 * recalcula a caixa a cada execução e IMPRIME o que achou, então trocar o
 * arquivo de origem e rodar de novo é o procedimento inteiro.
 *
 * ═══ Onde mora o ferramental de PNG ═══
 *
 * Em `scripts/lib/png.ts` — ler, escrever, recortar, reamostrar. Ele saiu
 * daqui quando nasceu `gerar-simbolo-gestalt.ts`: copiar um desfiltrador de
 * PNG é a forma mais cara possível de ter dois bugs diferentes no mesmo
 * formato.
 *
 * ═══ Por que não há dependência nova ═══
 *
 * O repo não tem sharp, pngjs, jimp nem canvas, e um PNG de cor indexada não
 * está em jogo: a arte é RGBA/8 bits sem entrelaçamento. Isso cabe em
 * `node:zlib` + ~120 linhas, e é preferível a acrescentar uma dependência
 * nativa (sharp) a um projeto que precisa instalar numa VPS de cliente.
 *
 * Uso:  pnpm tsx scripts/gerar-logo-gestalt.ts
 */

import path from "node:path";

import {
  caixaDaArte,
  escreverPng,
  lerPng,
  recortar,
  type Imagem,
} from "./lib/png";

const RAIZ = process.cwd();
/**
 * A arte crua mora FORA de `public/`, e o `.gitignore` cobre `assets-fonte/`.
 * `Dockerfile:79` copia `public/` inteiro para a imagem de todo self-hoster:
 * deixar a origem lá serviria 315 KB de PNG não recortado pela web, ao lado das
 * duas versões recortadas que são as que o produto de fato usa.
 */
const ORIGEM = path.join(RAIZ, "assets-fonte", "logo", "Design sem nome (2).png");

/**
 * O limiar que separa "isto é o verde da marca" de "isto é o texto escuro".
 *
 * Por canal, e não por distância a `#171717`: o anti-aliasing desta arte é
 * feito no ALFA (1.305.557 dos 1.572.528 pixels têm alfa 0), então o RGB das
 * bordas continua sendo o mesmo `#171717` do miolo. Uma régua por distância
 * classificaria as bordas como "quase preto" e as trataria diferente do miolo,
 * serrilhando a letra.
 */
const MARGEM_DE_VERDE = 24;

const ehVerde = (r: number, g: number, b: number) => g - Math.max(r, b) > MARGEM_DE_VERDE;

/**
 * Troca o texto escuro por branco e deixa o verde intocado.
 *
 * O ALFA é preservado byte a byte, e é isso que salva o anti-aliasing: num PNG
 * de alfa não-premultiplicado, a suavidade da borda está no canal A, não numa
 * mistura já feita no RGB. Reescrever só o RGB mantém a curva da letra.
 */
function escurosParaBranco(img: Imagem): Imagem {
  const px = Buffer.from(img.px);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! === 0) continue;
    if (ehVerde(px[i]!, px[i + 1]!, px[i + 2]!)) continue;
    px[i] = 0xff;
    px[i + 1] = 0xff;
    px[i + 2] = 0xff;
  }
  return { largura: img.largura, altura: img.altura, px };
}

// ─────────────────────────────────────────────────────────────────────────

function main(): void {
  const original = lerPng(ORIGEM);
  console.log(`origem: ${original.largura}x${original.altura} (arquivo inteiro)`);

  const caixa = caixaDaArte(original);
  const arte = recortar(original, caixa);
  const proporcao = (arte.largura / arte.altura).toFixed(2);
  console.log(
    `caixa da arte: x ${caixa.x0}→${caixa.x1}, y ${caixa.y0}→${caixa.y1}` +
      `  ⇒  ${arte.largura}x${arte.altura} (${proporcao}:1)`,
  );
  const arRemovido = 1 - (arte.largura * arte.altura) / (original.largura * original.altura);
  console.log(`ar transparente removido: ${(arRemovido * 100).toFixed(1)}% da área`);

  const branca = escurosParaBranco(arte);

  // Duas saídas, e a barra estreita NÃO tem uma terceira: entre 768 e 1023 o
  // CSS recorta o quadrado esquerdo da arte com `object-fit: cover` (ver
  // `.app-sidebar .nav-logo` no globals.css). Um arquivo "só a marca" gerado
  // aqui serviria a nossa logo e mostraria a NOSSA marca na barra estreita de
  // quem configurou a própria — o recorte serve qualquer arte.
  const saidas: ReadonlyArray<readonly [string, Imagem]> = [
    ["gestalt-crm.png", arte],
    ["gestalt-crm-branco.png", branca],
  ];
  for (const [nome, img] of saidas) {
    const destino = path.join(RAIZ, "public", nome);
    escreverPng(destino, img);
    console.log(`escrito: public/${nome}  ${img.largura}x${img.altura}`);
  }

  // ─── A prova ───────────────────────────────────────────────────────────
  // Sem ela o script "funciona" sem evidência: um bug no codificador sairia
  // como um arquivo de tamanho plausível que o navegador desenha errado.
  // Relemos do DISCO, não da memória.
  const conferida = lerPng(path.join(RAIZ, "public", "gestalt-crm-branco.png"));
  if (conferida.largura !== arte.largura || conferida.altura !== arte.altura) {
    throw new Error(
      `releitura deu ${conferida.largura}x${conferida.altura}, ` +
        `esperava ${arte.largura}x${arte.altura}`,
    );
  }
  let escurosVisiveis = 0;
  let verdesVivos = 0;
  for (let i = 0; i < conferida.px.length; i += 4) {
    if (conferida.px[i + 3]! === 0) continue;
    const [r, g, b] = [conferida.px[i]!, conferida.px[i + 1]!, conferida.px[i + 2]!];
    if (ehVerde(r, g, b)) verdesVivos += 1;
    else if (r < 0x80 && g < 0x80 && b < 0x80) escurosVisiveis += 1;
  }
  if (escurosVisiveis > 0) {
    throw new Error(`${escurosVisiveis} pixels escuros sobreviveram na versão branca`);
  }
  if (verdesVivos === 0) {
    throw new Error("o verde da marca sumiu — a regra de cor comeu o que devia preservar");
  }
  console.log(
    `prova: releitura ${conferida.largura}x${conferida.altura}, ` +
      `0 pixels escuros opacos, ${verdesVivos} pixels de verde preservados`,
  );
}

main();
