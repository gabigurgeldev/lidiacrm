"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Microphone, Pause, Play } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { MediaUnavailable } from "./MediaUnavailable";
import { OndaDeAudio } from "./OndaDeAudio";
import { mediaSrc } from "./media-utils";

const RATES = [1, 1.5, 2] as const;

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  messageId: string;
  isOutbound: boolean;
}

/**
 * Player de voz no formato do WhatsApp: play/pause redondo, barras de progresso,
 * tempo e velocidade.
 *
 * ═══ ⚠️ O `<input type="range">` NÃO SUMIU — ele ficou INVISÍVEL POR CIMA ═══
 *
 * A tentação óbvia ao trocar a barra fina pelas barrinhas é desenhar as barras e
 * pendurar um `onClick` nelas. Isso custaria tudo o que o `range` dá de graça e
 * que ninguém lembra de reimplementar: navegação por seta e Home/End, `aria`
 * de valor, arrasto contínuo com o ponteiro capturado, e o comportamento do
 * leitor de tela ao anunciar a posição.
 *
 * Então as barras são o DESENHO (`aria-hidden`, sem eventos) e o `range` de
 * sempre é o CONTROLE, esticado por cima com `opacity: 0`. O seek continua sendo
 * o mesmo código de antes.
 *
 * ═══ A velocidade só aparece depois do primeiro play ═══
 *
 * Como no WhatsApp. Antes de tocar, "1x" é um botão que não responde a nenhuma
 * pergunta que a pessoa esteja fazendo — e ele disputava espaço com o tempo, que
 * responde a uma.
 */
export function AudioPlayer({ messageId, isOutbound }: Props) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rateIdx, setRateIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  /** Uma vez verdadeiro, fica: a velocidade não some quando o áudio pausa. */
  const [jaTocou, setJaTocou] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onEnded = () => setPlaying(false);
    const onError = () => setFailed(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, []);

  if (failed) return <MediaUnavailable kind="Áudio" className="h-12 w-60" />;

  // ponytail: OGG streams report Infinity at loadedmetadata; self-heal when refined
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
      setJaTocou(true);
    }
  };

  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = RATES[next]!;
  };

  const seek = (value: number) => {
    if (audioRef.current) audioRef.current.currentTime = value;
    setCurrent(value);
  };

  // O tempo mostra o DECORRIDO enquanto toca e a DURAÇÃO quando parado — é o
  // que o WhatsApp faz, e é a leitura certa nos dois momentos: parado, a pergunta
  // é "quanto isso vai me tomar?"; tocando, é "quanto falta?".
  const tempo = playing || current > 0 ? fmt(current) : fmt(safeDuration);
  const progresso = safeDuration > 0 ? Math.min(1, current / safeDuration) : 0;

  // O selo da ESQUERDA é o do WhatsApp: microfone verde enquanto parado, e a
  // velocidade no mesmo lugar depois do primeiro play — a pessoa acha o "2x"
  // onde o olho já estava, em vez de mais um botão no fim da linha.
  const selo = jaTocou ? (
    <button
      type="button"
      aria-label={`${t("Velocidade de reprodução")}: ${RATES[rateIdx]}x`}
      onClick={cycleRate}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/[0.07] text-[13px] font-semibold tabular-nums text-foreground transition-colors hover:bg-black/[0.12]"
    >
      {RATES[rateIdx]}x
    </button>
  ) : (
    <span
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
      aria-hidden
    >
      <Microphone size={22} weight="fill" />
    </span>
  );

  return (
    <div
      className={cn(
        "flex w-[17rem] max-w-full items-center gap-2.5 py-1",
        isOutbound && "flex-row-reverse",
      )}
    >
      <audio ref={audioRef} src={mediaSrc(messageId)} preload="metadata" />
      {selo}
      <button
        type="button"
        aria-label={playing ? t("Pausar áudio") : t("Reproduzir áudio")}
        onClick={toggle}
        className="flex size-8 shrink-0 items-center justify-center text-[var(--bolha-meta)] transition-transform hover:scale-110"
      >
        {playing ? (
          <Pause size={26} weight="fill" aria-hidden />
        ) : (
          <Play size={26} weight="fill" aria-hidden />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* As barras desenham; o `range` por cima controla. Ver o cabeçalho. */}
        <div className="relative h-7">
          <OndaDeAudio semente={messageId} progresso={progresso} isOutbound={isOutbound} />
          {/* A bolinha de posição, como no WhatsApp: mostra ONDE o áudio está,
              não só até onde as barras acenderam. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-sm transition-[left] duration-100"
            style={{ left: `${progresso * 100}%` }}
          />
          <input
            type="range"
            aria-label={t("Progresso do áudio")}
            aria-valuetext={`${fmt(current)} ${t("de")} ${fmt(safeDuration)}`}
            min="0"
            max={String(safeDuration || 1)}
            step="0.1"
            value={current}
            onChange={(e) => seek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="text-[11px] tabular-nums text-[var(--bolha-meta)]">{tempo}</span>
      </div>
    </div>
  );
}
