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
 * ═══ Por que não há dependência nova ═══
 *
 * O repo não tem sharp, pngjs, jimp nem canvas, e um PNG de cor indexada não
 * está em jogo: a arte é RGBA/8 bits sem entrelaçamento. Isso cabe em
 * `node:zlib` + ~120 linhas, e é preferível a acrescentar uma dependência
 * nativa (sharp) a um projeto que precisa instalar numa VPS de cliente.
 *
 * Uso:  pnpm tsx scripts/gerar-logo-gestalt.ts
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

interface Imagem {
  readonly largura: number;
  readonly altura: number;
  /** RGBA, 4 bytes por pixel, alfa NÃO pré-multiplicado. */
  readonly px: Buffer;
}

// ─────────────────────────────────────────────────────────────────────────
// PNG: ler
// ─────────────────────────────────────────────────────────────────────────

function lerPng(arquivo: string): Imagem {
  const b = readFileSync(arquivo);
  if (b.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${arquivo} não é um PNG (assinatura errada)`);
  }

  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  const profundidade = b[24];
  const tipoDeCor = b[25];
  const entrelacado = b[28];

  // As três guardas são por modo de falha SILENCIOSO, não por paranoia: cada
  // uma destas variantes decodificaria para lixo com o desfiltrador abaixo, e
  // o lixo sairia como um PNG válido cheio de ruído.
  if (tipoDeCor !== 6) {
    throw new Error(`esperava RGBA (colorType 6), veio colorType ${tipoDeCor}`);
  }
  if (profundidade !== 8) {
    throw new Error(`esperava 8 bits por canal, veio ${profundidade}`);
  }
  if (entrelacado !== 0) {
    throw new Error(
      `a arte está entrelaçada (Adam7). Este desfiltrador só lê PNG sequencial — ` +
        `reexporte sem entrelaçamento`,
    );
  }

  const pedacos: Buffer[] = [];
  let off = 8;
  while (off < b.length) {
    const tamanho = b.readUInt32BE(off);
    const tipo = b.subarray(off + 4, off + 8).toString("latin1");
    if (tipo === "IDAT") pedacos.push(b.subarray(off + 8, off + 8 + tamanho));
    if (tipo === "IEND") break;
    off += 12 + tamanho;
  }

  const cru = inflateSync(Buffer.concat(pedacos));
  const BPP = 4;
  const linha = largura * BPP;
  const px = Buffer.alloc(altura * linha);

  const media = (a: number, b2: number) => (a + b2) >> 1;
  const paeth = (a: number, b2: number, c: number) => {
    const p = a + b2 - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b2);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c;
  };

  let lido = 0;
  for (let y = 0; y < altura; y += 1) {
    const filtro = cru[lido];
    lido += 1;
    for (let x = 0; x < linha; x += 1) {
      const atual = cru[lido + x]!;
      const A = x >= BPP ? px[y * linha + x - BPP]! : 0;
      const B = y > 0 ? px[(y - 1) * linha + x]! : 0;
      const C = x >= BPP && y > 0 ? px[(y - 1) * linha + x - BPP]! : 0;
      let v: number;
      if (filtro === 0) v = atual;
      else if (filtro === 1) v = atual + A;
      else if (filtro === 2) v = atual + B;
      else if (filtro === 3) v = atual + media(A, B);
      else if (filtro === 4) v = atual + paeth(A, B, C);
      else throw new Error(`filtro PNG desconhecido (${filtro}) na linha ${y}`);
      px[y * linha + x] = v & 255;
    }
    lido += linha;
  }

  return { largura, altura, px };
}

// ─────────────────────────────────────────────────────────────────────────
// PNG: escrever
// ─────────────────────────────────────────────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = TABELA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pedaco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

function escreverPng(arquivo: string, img: Imagem): void {
  const linha = img.largura * 4;
  // Filtro 0 (None) em toda scanline. Custa alguns KB contra um filtro
  // adaptativo, e poupa o modo de falha de um preditor escrito à mão.
  const cru = Buffer.alloc(img.altura * (linha + 1));
  for (let y = 0; y < img.altura; y += 1) {
    cru[y * (linha + 1)] = 0;
    img.px.copy(cru, y * (linha + 1) + 1, y * linha, (y + 1) * linha);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.largura, 0);
  ihdr.writeUInt32BE(img.altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo
  ihdr[12] = 0; // sem entrelaçamento

  writeFileSync(
    arquivo,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pedaco("IHDR", ihdr),
      pedaco("IDAT", deflateSync(cru, { level: 9 })),
      pedaco("IEND", Buffer.alloc(0)),
    ]),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Operações
// ─────────────────────────────────────────────────────────────────────────

/** A caixa dos pixels que têm alguma opacidade. Calculada, nunca fixada. */
function caixaDaArte(img: Imagem): { x0: number; y0: number; x1: number; y1: number } {
  const linha = img.largura * 4;
  let x0 = img.largura;
  let y0 = img.altura;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.altura; y += 1) {
    for (let x = 0; x < img.largura; x += 1) {
      if (img.px[y * linha + x * 4 + 3]! === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("a arte é inteiramente transparente");
  return { x0, y0, x1, y1 };
}

function recortar(img: Imagem, c: { x0: number; y0: number; x1: number; y1: number }): Imagem {
  const largura = c.x1 - c.x0 + 1;
  const altura = c.y1 - c.y0 + 1;
  const px = Buffer.alloc(largura * altura * 4);
  for (let y = 0; y < altura; y += 1) {
    const origem = (y + c.y0) * img.largura * 4 + c.x0 * 4;
    img.px.copy(px, y * largura * 4, origem, origem + largura * 4);
  }
  return { largura, altura, px };
}

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
