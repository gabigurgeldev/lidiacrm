/**
 * O ferramental de PNG dos scripts de arte — ler, escrever, recortar,
 * reamostrar.
 *
 * ═══ Por que é código nosso, e não uma dependência ═══
 *
 * O repo não tem pngjs, jimp nem canvas, e sharp é dependência NATIVA: ela
 * entra na árvore de instalação de uma VPS de cliente para servir dois
 * arquivos que são gerados uma vez e commitados. A arte que passa por aqui é
 * RGBA/8 bits sem entrelaçamento, e isso cabe em `node:zlib` + ~150 linhas.
 *
 * ═══ Por que é um módulo, e não um script ═══
 *
 * Isto morava inteiro dentro de `scripts/gerar-logo-gestalt.ts`. Quando nasceu
 * o segundo gerador (`gerar-simbolo-gestalt.ts`, o "GC" da barra recolhida e do
 * ícone da aba), a alternativa era copiar o decodificador de PNG — e um
 * desfiltrador duplicado é a forma mais cara possível de ter dois bugs
 * diferentes no mesmo formato.
 *
 * Nada aqui é importado por código de RUNTIME: `tsconfig.typecheck.json`
 * exclui `scripts/**`, e o Dockerfile não copia a pasta.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

export interface Imagem {
  readonly largura: number;
  readonly altura: number;
  /** RGBA, 4 bytes por pixel, alfa NÃO pré-multiplicado. */
  readonly px: Buffer;
}

export interface Caixa {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

// ─────────────────────────────────────────────────────────────────────────
// PNG: ler
// ─────────────────────────────────────────────────────────────────────────

export function lerPng(arquivo: string): Imagem {
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

export function escreverPng(arquivo: string, img: Imagem): void {
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
// Operações de imagem
// ─────────────────────────────────────────────────────────────────────────

/**
 * A caixa dos pixels opacos. Calculada, nunca fixada.
 *
 * ⚠️ `limiarDeAlfa` NÃO é botão de gosto — é o que separa a arte do HALO.
 * Medido na arte do símbolo: contando qualquer alfa acima de zero, a caixa dá
 * 1175x1052; a partir de alfa 8, dá 832x820. A diferença são ~340px de brilho
 * invisível a olho nu que o exportador deixou em volta do desenho, e ela chega
 * ao arquivo final como margem assimétrica — o disco sai encostado num canto do
 * quadrado.
 *
 * O padrão é 1 (qualquer opacidade) porque é o que `gerar-logo-gestalt.ts`
 * sempre usou e o que a arte dele pede. Quem tem halo passa um limiar, e o
 * script IMPRIME a caixa que achou — é assim que o halo aparece em vez de virar
 * margem em silêncio.
 */
export function caixaDaArte(img: Imagem, limiarDeAlfa = 1): Caixa {
  const linha = img.largura * 4;
  let x0 = img.largura;
  let y0 = img.altura;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.altura; y += 1) {
    for (let x = 0; x < img.largura; x += 1) {
      if (img.px[y * linha + x * 4 + 3]! < limiarDeAlfa) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("a arte é inteiramente transparente");
  return { x0, y0, x1, y1 };
}

export function recortar(img: Imagem, c: Caixa): Imagem {
  const largura = c.x1 - c.x0 + 1;
  const altura = c.y1 - c.y0 + 1;
  const px = Buffer.alloc(largura * altura * 4);
  for (let y = 0; y < altura; y += 1) {
    const origem = (y + c.y0) * img.largura * 4 + c.x0 * 4;
    img.px.copy(px, y * largura * 4, origem, origem + largura * 4);
  }
  return { largura, altura, px };
}

/**
 * Reduz a imagem para `lado`x`lado` por média de caixa.
 *
 * ⚠️ A MÉDIA É FEITA COM O ALFA PRÉ-MULTIPLICADO, e essa é a única parte não
 * óbvia daqui. Num PNG de alfa não-premultiplicado, o RGB de um pixel
 * totalmente transparente é arbitrário — nesta arte, preto. Somar o RGB cru de
 * uma vizinhança que é metade borda verde e metade nada puxa a média para o
 * preto e devolve uma auréola escura em volta do desenho. Pré-multiplicando, o
 * pixel invisível contribui com zero de cor E zero de peso, que é o que ele de
 * fato é.
 *
 * Média de caixa e não bilinear: a redução aqui é grande (1256 para 128, ~10x),
 * e nesse regime a bilinear amostra pontos isolados e serrilha. A caixa lê
 * TODOS os pixels de origem, que é o que preserva a espessura do anel.
 *
 * Só reduz. Ampliar por média devolveria blocos — se um dia precisar, é outro
 * algoritmo, e o erro abaixo diz isso em vez de entregar o borrão.
 */
export function reamostrar(img: Imagem, lado: number): Imagem {
  if (lado > img.largura || lado > img.altura) {
    throw new Error(
      `reamostrar só reduz: pedido ${lado}px de uma arte ${img.largura}x${img.altura}`,
    );
  }
  const px = Buffer.alloc(lado * lado * 4);
  const escalaX = img.largura / lado;
  const escalaY = img.altura / lado;

  for (let y = 0; y < lado; y += 1) {
    const y0 = Math.floor(y * escalaY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * escalaY));
    for (let x = 0; x < lado; x += 1) {
      const x0 = Math.floor(x * escalaX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * escalaX));

      let somaR = 0;
      let somaG = 0;
      let somaB = 0;
      let somaA = 0;
      let amostras = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * img.largura + sx) * 4;
          const a = img.px[i + 3]!;
          somaR += img.px[i]! * a;
          somaG += img.px[i + 1]! * a;
          somaB += img.px[i + 2]! * a;
          somaA += a;
          amostras += 1;
        }
      }

      const destino = (y * lado + x) * 4;
      const alfa = Math.round(somaA / amostras);
      px[destino + 3] = alfa;
      // `somaA` no divisor, não `amostras`: é a desmultiplicação. Com tudo
      // transparente não há cor a recuperar, e o pixel fica em zero.
      if (somaA > 0) {
        px[destino] = Math.round(somaR / somaA);
        px[destino + 1] = Math.round(somaG / somaA);
        px[destino + 2] = Math.round(somaB / somaA);
      }
    }
  }
  return { largura: lado, altura: lado, px };
}
