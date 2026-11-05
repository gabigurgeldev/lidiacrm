"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileText, Plus, X } from "@/lib/ui/icons";
import { formatBytes } from "@/components/inbox/media/media-utils";
import { LIMITE_DO_LOTE } from "@/lib/inbox/enviar-lote";

interface Props {
  /** Vazio = diálogo fechado. */
  files: File[];
  sending: boolean;
  /** Durante um lote: quantos já saíram de quantos. */
  progresso?: { feitos: number; total: number } | null;
  onCancel: () => void;
  /** Tira um arquivo do lote antes de enviar. */
  onRemover?: (indice: number) => void;
  /** "+ Adicionar" — mais fotos/vídeos no mesmo lote. */
  onAdicionar?: (files: File[]) => void;
  /**
   * Envia. A legenda vai só na PRIMEIRA mensagem, como no WhatsApp: repetida
   * em cada foto ela vira ruído no celular do cliente. Devolve se a legenda foi
   * usada — num lote que parou no meio, a primeira já saiu com ela, e o que
   * sobra no diálogo não pode reenviá-la.
   */
  onSend: (caption: string) => Promise<{ legendaUsada: boolean }> | void;
}

const ehMidia = (f: File) => /^(image|video)\//.test(f.type);

/** Preview antes do envio (padrão WhatsApp): thumb ou card + legenda; em lote, uma grade. */
export function AttachmentPreviewDialog({
  files,
  sending,
  progresso,
  onCancel,
  onRemover,
  onAdicionar,
  onSend,
}: Props) {
  const t = useT();
  const idAdicionar = useId();
  const [caption, setCaption] = useState("");
  const aberto = files.length > 0;
  // Legenda nova a cada diálogo que abre; adicionar/remover no meio não a apaga.
  // Ajuste durante o render (padrão do React), não num effect: o effect
  // desenharia um quadro com a legenda velha antes de limpá-la.
  const [abertoAntes, setAbertoAntes] = useState(aberto);
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto);
    if (!aberto) setCaption("");
  }

  if (!aberto) return null;
  const lote = files.length > 1;
  const soMidia = files.every(ehMidia);
  const podeAdicionar = !!onAdicionar && soMidia && files.length < LIMITE_DO_LOTE && !sending;

  async function enviar() {
    if (sending) return;
    const r = await onSend(caption.trim());
    if (r?.legendaUsada) setCaption("");
  }

  const titulo = lote
    ? t("Enviar {n} anexos").replace("{n}", String(files.length))
    : t("Enviar anexo");

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onCancel()}>
      <DialogContent className={lote ? "max-w-lg" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        {lote ? (
          <ul className="grid grid-cols-3 gap-2" aria-label={t("Anexos")}>
            {files.map((file, i) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
                className="relative aspect-square overflow-hidden rounded-lg bg-muted/40"
              >
                <Miniatura file={file} />
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {t("Com legenda")}
                  </span>
                )}
                {onRemover && !sending && (
                  <button
                    type="button"
                    onClick={() => onRemover(i)}
                    aria-label={t("Remover {nome}").replace("{nome}", file.name)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                  >
                    <X size={12} weight="bold" aria-hidden />
                  </button>
                )}
              </li>
            ))}
            {podeAdicionar && (
              <li>
                <label
                  htmlFor={idAdicionar}
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/40"
                >
                  <Plus size={20} aria-hidden />
                  {t("Adicionar")}
                </label>
              </li>
            )}
          </ul>
        ) : (
          <div className="relative flex items-center justify-center rounded-lg bg-muted/40 p-3">
            <PreviewGrande file={files[0]!} />
            {podeAdicionar && (
              <label
                htmlFor={idAdicionar}
                className="absolute bottom-2 right-2 flex cursor-pointer items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium shadow hover:bg-background"
              >
                <Plus size={14} aria-hidden />
                {t("Adicionar")}
              </label>
            )}
          </div>
        )}

        {podeAdicionar && (
          <input
            id={idAdicionar}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const novos = Array.from(e.target.files ?? []);
              if (novos.length > 0) onAdicionar?.(novos);
              e.target.value = "";
            }}
          />
        )}

        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={lote ? t("Legenda da primeira foto (opcional)") : t("Legenda (opcional)")}
          aria-label={t("Legenda")}
          disabled={sending}
          onKeyDown={(e) => e.key === "Enter" && void enviar()}
        />
        {progresso && progresso.total > 1 && (
          <p className="text-xs text-muted-foreground" role="status">
            {t("Enviando {feitos} de {total}…")
              .replace("{feitos}", String(Math.min(progresso.feitos + 1, progresso.total)))
              .replace("{total}", String(progresso.total))}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={() => void enviar()} disabled={sending}>
            {t("Enviar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useObjectUrl(file: File): string | null {
  const url = useMemo(() => (ehMidia(file) ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

function PreviewGrande({ file }: { file: File }) {
  const objectUrl = useObjectUrl(file);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  return (
    <>
      {isImage && objectUrl && (
        <img src={objectUrl} alt={file.name} className="max-h-64 rounded-md object-contain" />
      )}
      {isVideo && objectUrl && <video src={objectUrl} controls className="max-h-64 rounded-md" />}
      {!isImage && !isVideo && (
        <div className="flex items-center gap-3 py-4">
          <FileText size={28} weight="duotone" className="text-primary" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
        </div>
      )}
    </>
  );
}

function Miniatura({ file }: { file: File }) {
  const objectUrl = useObjectUrl(file);
  if (file.type.startsWith("image/") && objectUrl) {
    return <img src={objectUrl} alt={file.name} className="size-full object-cover" />;
  }
  if (file.type.startsWith("video/") && objectUrl) {
    return <video src={objectUrl} muted className="size-full object-cover" />;
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center">
      <FileText size={22} weight="duotone" className="text-primary" aria-hidden />
      <span className="line-clamp-2 text-[10px]">{file.name}</span>
    </div>
  );
}
