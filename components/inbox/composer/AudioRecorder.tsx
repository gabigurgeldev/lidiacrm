"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Microphone, Pause, PaperPlaneTilt, Trash } from "@/lib/ui/icons";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";

const PREFERRED_MIMES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"];
/** Barras visíveis da onda ao vivo — o mais recente entra pela direita. */
const BARRAS = 36;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
}

interface Props {
  conversationId: string;
  disabled?: boolean;
  /**
   * Avisa o campo de escrever que a gravação começou/acabou: enquanto grava, a
   * barra inteira vira a barra de gravação (como no WhatsApp), e os outros
   * botões saem para não disputar o clique com o "enviar".
   */
  onGravandoChange?: (gravando: boolean) => void;
}

/**
 * Gravação de voz estilo WhatsApp: microfone → barra de gravação com lixeira,
 * ponto vermelho, tempo, ONDA AO VIVO do que o microfone ouve, pausar/retomar e
 * enviar → mensagem de voz (PTT).
 *
 * A onda vem de um `AnalyserNode` lendo o próprio stream do microfone: é a
 * prova, para quem grava, de que o som está entrando. Sem ela, um microfone
 * mudo só se descobre depois de enviar um áudio em silêncio.
 */
export function AudioRecorder({ conversationId, disabled, onGravandoChange }: Props) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [niveis, setNiveis] = useState<number[]>(() => Array(BARRAS).fill(0));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const startingRef = useRef(false);
  const pausadoRef = useRef(false);
  const upload = useUploadMedia();
  const send = useSendMessage();

  useEffect(() => {
    onGravandoChange?.(recording);
  }, [recording, onGravandoChange]);

  useEffect(() => {
    if (!recording || pausado) return;
    const relogio = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(relogio);
  }, [recording, pausado]);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  // Trocar de conversa/rota no meio de uma gravação não pode deixar o mic aberto.
  useEffect(
    () => () => {
      discardRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive")
        recorderRef.current.stop();
      cleanupStream();
    },
    [],
  );

  /** Lê o nível do microfone ~11×/s e empurra uma barra nova para a onda. */
  function ouvir(stream: MediaStream) {
    const Ctx =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      // Nasce SUSPENSO em parte dos navegadores (política de autoplay): sem o
      // resume, a onda fica parada mesmo com o microfone gravando.
      void ctx.resume().catch(() => {});
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analisador);
      const dados = new Uint8Array(analisador.frequencyBinCount);
      const ler = setInterval(() => {
        if (!audioCtxRef.current) {
          clearInterval(ler);
          return;
        }
        if (pausadoRef.current) return;
        analisador.getByteTimeDomainData(dados);
        let pico = 0;
        for (const v of dados) pico = Math.max(pico, Math.abs(v - 128));
        const nivel = Math.min(1, pico / 64);
        setNiveis((n) => [...n.slice(1), nivel]);
      }, 90);
    } catch {
      // Sem Web Audio a gravação segue; só a onda fica parada.
    }
  }

  async function start() {
    if (startingRef.current || recording) return;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      discardRef.current = false;
      pausadoRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        cleanupStream();
        setRecording(false);
        setPausado(false);
        setElapsed(0);
        setNiveis(Array(BARRAS).fill(0));
        if (discardRef.current || chunksRef.current.length === 0) return;
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        void upload
          .mutateAsync({
            conversationId,
            file: blob,
            filename: `ptt.${type.includes("ogg") ? "ogg" : "webm"}`,
          })
          .then((uploaded) =>
            send.mutate(
              {
                conversation_id: conversationId,
                type: "audio",
                media_storage_path: uploaded.storage_path,
                media_mime: uploaded.media_mime,
                media_size_bytes: uploaded.media_size_bytes,
              },
              {},
            ),
          )
          .catch(() => {
            // toast já disparado pelo onError de useUploadMedia
          });
      };
      recorderRef.current = rec;
      rec.start();
      ouvir(stream);
      setRecording(true);
    } catch {
      cleanupStream();
      // permissão negada / sem mic — não gravar é o estado final; toast simples
      const { showApiError } = await import("@/components/feedback/ApiErrorToast");
      showApiError(
        new Error(t("Não consegui acessar o microfone. Verifique a permissão do navegador.")),
      );
    } finally {
      startingRef.current = false;
    }
  }

  function stopIfRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function alternarPausa() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording" && typeof rec.pause === "function") {
      rec.pause();
      pausadoRef.current = true;
      setPausado(true);
    } else if (rec.state === "paused") {
      rec.resume();
      pausadoRef.current = false;
      setPausado(false);
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!recording) {
    return (
      <button
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:opacity-40"
        aria-label={t("Gravar áudio")}
        onClick={start}
        disabled={disabled}
      >
        <Microphone size={24} weight="regular" aria-hidden />
      </button>
    );
  }

  return (
    <div
      className="gravacao-barra flex min-w-0 flex-1 items-center justify-end gap-2"
      role="group"
      aria-label={t("Gravando áudio")}
    >
      <button
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-destructive"
        aria-label={t("Cancelar gravação")}
        onClick={() => {
          discardRef.current = true;
          stopIfRecording();
        }}
      >
        <Trash size={22} weight="regular" aria-hidden />
      </button>

      <span className="flex shrink-0 items-center gap-2 text-[15px] tabular-nums text-foreground">
        <span
          className={
            pausado
              ? "size-2.5 rounded-full bg-muted-foreground"
              : "gravacao-ponto size-2.5 rounded-full bg-destructive"
          }
          aria-hidden
        />
        {fmt(elapsed)}
      </span>

      <div
        className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden px-2"
        aria-hidden
      >
        {niveis.map((n, i) => (
          <span
            key={i}
            className="gravacao-onda-barra w-[3px] shrink-0 rounded-full bg-[var(--bolha-meta)]"
            style={{ height: `${Math.max(4, Math.round(n * 28))}px` }}
          />
        ))}
      </div>

      <button
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-black/5"
        aria-label={pausado ? t("Continuar gravação") : t("Pausar gravação")}
        onClick={alternarPausa}
      >
        {pausado ? (
          <Microphone size={22} weight="fill" aria-hidden />
        ) : (
          <Pause size={22} weight="fill" aria-hidden />
        )}
      </button>

      <button
        type="button"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm transition-transform hover:scale-105 active:scale-95"
        aria-label={t("Enviar áudio")}
        onClick={stopIfRecording}
      >
        <PaperPlaneTilt size={20} weight="fill" aria-hidden />
      </button>
    </div>
  );
}
