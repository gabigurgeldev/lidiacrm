/**
 * Vídeo → o formato que o WhatsApp toca, UMA vez, no upload.
 *
 * ─── O defeito, medido em produção (2026-10-01) ─────────────────────────────
 *
 * O envio de vídeo pelo WAHA pedia `convert: true` (`lib/waha/media-send.ts`),
 * e o WAHA atende reencodando o arquivo INTEIRO em H.264 (`ffmpeg -c:v libx264`)
 * a cada destinatário. Um disparo com vídeo para 274 contatos virou 274
 * reencodes do mesmo arquivo: numa VPS de 2 núcleos cada um levava vários
 * minutos, eles se empilharam (8 simultâneos), o WAHA bateu no teto de memória
 * e o WhatsApp de TODAS as organizações caiu. Em 2 horas o disparo entregou 10
 * mensagens.
 *
 * ─── O conserto ─────────────────────────────────────────────────────────────
 *
 * Normalizar no upload, uma vez, e mandar com `convert: false`. Quase todo
 * vídeo de celular já é H.264 + AAC: aí só se troca o contêiner (`-c copy`,
 * instantâneo) e se põe o índice no começo (`faststart`, para o WhatsApp tocar
 * enquanto baixa). Só o que não é (HEVC de iPhone, VP9…) é reencodado — e uma
 * vez só, não por destinatário.
 *
 * O arquivo pronto ganha o sufixo `.wa.mp4`. É o sufixo que diz ao envio que
 * pode pular a conversão: sem coluna nova, e um disparo antigo (sem o sufixo)
 * segue exatamente como antes.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SUFIXO_DE_VIDEO_PRONTO = ".wa.mp4";
export const MIME_DO_VIDEO_PRONTO = "video/mp4";

/** Este arquivo já está no formato do WhatsApp (passou por `paraVideoDoWhatsApp`)? */
export function videoJaPronto(caminho: string | null | undefined): boolean {
  return typeof caminho === "string" && caminho.endsWith(SUFIXO_DE_VIDEO_PRONTO);
}

/** Roda um binário e devolve o stdout; rejeita se sair diferente de zero. */
async function executar(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, args, { cwd });
    let saida = "";
    let erro = "";
    proc.stdout?.on("data", (d: Buffer) => {
      saida += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      erro = (erro + d.toString()).slice(-500);
    });
    proc.on("error", (err) => reject(new Error(`${bin}_spawn_failed: ${err.message}`)));
    proc.on("close", (code) => (code === 0 ? resolve(saida) : reject(new Error(`${bin}_exit_${code}: ${erro}`))));
  });
}

interface Fluxo {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
}

/**
 * Já toca no WhatsApp sem reencode? H.264 em yuv420p e, se houver som, AAC.
 * Puro, para o teste cobrir a decisão sem ffmpeg.
 */
export function jaEhCompativel(fluxos: Fluxo[]): boolean {
  const video = fluxos.filter((f) => f.codec_type === "video");
  const audio = fluxos.filter((f) => f.codec_type === "audio");
  if (video.length !== 1) return false;
  if (video[0]!.codec_name !== "h264" || video[0]!.pix_fmt !== "yuv420p") return false;
  return audio.every((a) => a.codec_name === "aac");
}

export interface VideoPronto {
  buffer: Buffer;
  mime: typeof MIME_DO_VIDEO_PRONTO;
  /** `false` = só trocou o contêiner (o caso comum, instantâneo). */
  reencodado: boolean;
}

/**
 * Normaliza o vídeo para o WhatsApp. LANÇA quando não consegue — quem chama
 * guarda o original como antes (e o envio dele segue pedindo conversão).
 */
export async function paraVideoDoWhatsApp(
  input: { buffer: Buffer },
  deps: { run?: typeof executar } = {},
): Promise<VideoPronto> {
  const rodar = deps.run ?? executar;
  const dir = await mkdtemp(join(tmpdir(), "video-wa-"));
  try {
    const entrada = join(dir, "in.video");
    const saida = join(dir, "out.mp4");
    await writeFile(entrada, input.buffer);

    const sonda = await rodar(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", entrada],
      dir,
    );
    const fluxos = (JSON.parse(sonda) as { streams?: Fluxo[] }).streams ?? [];
    const copiar = jaEhCompativel(fluxos);

    const args = copiar
      ? ["-nostdin", "-y", "-i", entrada, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", saida]
      : [
          "-nostdin", "-y", "-i", entrada,
          "-map", "0:v:0", "-map", "0:a?",
          // Até 1280 de largura, dimensões pares (exigência do H.264 em yuv420p).
          "-vf", "scale=w='min(1280,iw)':h=-2",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-profile:v", "main", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "96k",
          "-movflags", "+faststart", "-f", "mp4", saida,
        ];
    await rodar("ffmpeg", args, dir);
    const buffer = await readFile(saida);
    if (buffer.length === 0) throw new Error("video_conversao_vazia");
    return { buffer, mime: MIME_DO_VIDEO_PRONTO, reencodado: !copiar };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
