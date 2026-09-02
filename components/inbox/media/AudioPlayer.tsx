"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Pause, Play } from "@/lib/ui/icons";
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

  return (
    <div className="flex w-[15.5rem] max-w-full items-center gap-2 py-0.5">
      <audio ref={audioRef} src={mediaSrc(messageId)} preload="metadata" />
      <button
        type="button"
        aria-label={playing ? t("Pausar áudio") : t("Reproduzir áudio")}
        onClick={toggle}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
          isOutbound
            ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30"
            : "bg-accent/15 text-accent hover:bg-accent/25",
        )}
      >
        {playing ? (
          <Pause size={16} weight="fill" aria-hidden />
        ) : (
          <Play size={16} weight="fill" aria-hidden />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* As barras desenham; o `range` por cima controla. Ver o cabeçalho. */}
        <div className="relative h-7">
          <OndaDeAudio semente={messageId} progresso={progresso} isOutbound={isOutbound} />
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
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums opacity-70">{tempo}</span>
        </div>
      </div>

      {jaTocou && (
        <button
          type="button"
          aria-label={`${t("Velocidade de reprodução")}: ${RATES[rateIdx]}x`}
          onClick={cycleRate}
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums transition-colors",
            isOutbound
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-accent/15 text-accent",
          )}
        >
          {RATES[rateIdx]}x
        </button>
      )}
    </div>
  );
}
