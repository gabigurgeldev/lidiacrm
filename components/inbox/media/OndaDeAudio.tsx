"use client";

import { cn } from "@/lib/utils";

/**
 * As barrinhas do áudio.
 *
 * ═══ ⚠️ ESTA NÃO É A FORMA DE ONDA REAL, E O CÓDIGO PRECISA DIZER ISSO ═══
 *
 * A real exigiria `decodeAudioData` sobre o arquivo inteiro. Num áudio de 4:37 —
 * há um assim na conversa que originou este trabalho — isso é a aba inteira
 * parada, decodificando megabytes, para decorar um player. Numa lista com vários
 * áudios, é a aba parada várias vezes.
 *
 * As barras saem de um hash do `messageId`: a mesma mensagem desenha sempre
 * igual (não pulam a cada render), e elas não afirmam nada sobre o conteúdo.
 * O que elas comunicam é PROGRESSO — quanto já tocou —, e isso é verdade.
 *
 * Chamar isto de "forma de onda" no código seria a mentira; por isso o nome do
 * arquivo é o que é e este parágrafo existe.
 */

/** Quantas barras cabem confortavelmente na largura da bolha de áudio. */
const BARRAS = 34;

/**
 * FNV-1a de 32 bits. Escolhido por ser curto, determinístico e sem dependência —
 * não há requisito criptográfico aqui, só de estabilidade.
 */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Alturas entre 0,22 e 1 — nunca zero.
 *
 * Uma barra de altura zero some, e um buraco no meio das barras parece silêncio
 * NAQUELE ponto do áudio: seria a decoração afirmando algo sobre o conteúdo, que
 * é exatamente o que este componente não faz.
 */
export function alturasDaOnda(semente: string, quantas = BARRAS): number[] {
  let h = hash(semente);
  return Array.from({ length: quantas }, () => {
    h = Math.imul(h, 0x01000193) >>> 0;
    return 0.22 + ((h >>> 8) % 78) / 100;
  });
}

export function OndaDeAudio({
  semente,
  /** 0 a 1. As barras já tocadas ficam acesas; as demais, apagadas. */
  progresso,
  isOutbound,
  className,
}: {
  semente: string;
  progresso: number;
  isOutbound: boolean;
  className?: string;
}) {
  const alturas = alturasDaOnda(semente);
  const tocadas = Math.round(progresso * alturas.length);

  return (
    <div
      className={cn("pointer-events-none flex h-7 items-center gap-[2px]", className)}
      aria-hidden
      data-testid="onda-de-audio"
    >
      {alturas.map((altura, i) => (
        <span
          key={i}
          className={cn(
            "onda-barra w-[2px] shrink-0 rounded-full",
            i < tocadas
              ? isOutbound
                ? "bg-primary-foreground"
                : "bg-accent"
              : isOutbound
                ? "bg-primary-foreground/35"
                : "bg-text-subtle/50",
          )}
          style={{ height: `${Math.round(altura * 100)}%` }}
        />
      ))}
    </div>
  );
}
