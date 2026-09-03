"use client";

import { useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { CircleNotch, Copy } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * "Enviar link para o cliente" — gera o link público de pareamento.
 *
 * ─── Por que isto existe ao lado do QR, e não no lugar dele ────────────────
 *
 * O QR do WhatsApp expira em ~20s. Mandar print para o cliente não funciona:
 * chega morto. Quem tinha o número em mãos usava o diálogo de QR; quem NÃO
 * tinha — o caso de quem ativa um cliente — não tinha caminho nenhum.
 *
 * ─── Por que o link não é recuperável depois ───────────────────────────────
 *
 * A URL aparece uma vez, aqui, e nenhuma rota a devolve depois. Quem fechou a
 * tela sem copiar gera outro — o que é mais barato que manter uma rota que
 * entrega credencial viva de volta. Mesmo princípio do bearer token da API.
 */
export function LinkDePareamento({
  channelSessionId,
  desabilitado,
}: {
  channelSessionId: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const [gerando, setGerando] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function gerar() {
    setGerando(true);
    try {
      const r = await apiClient.post<{ data: { url: string; expira_em: string } }>(
        `/api/v1/channel-sessions/${channelSessionId}/pairing-link`,
        {},
      );
      setUrl(r.data.url);
    } catch (err) {
      showApiError(err);
    } finally {
      setGerando(false);
    }
  }

  async function cancelar() {
    try {
      await apiClient.delete(`/api/v1/channel-sessions/${channelSessionId}/pairing-link`);
      setUrl(null);
      toast.success(t("Link cancelado."));
    } catch (err) {
      showApiError(err);
    }
  }

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("Link copiado."));
    } catch {
      // Fora de contexto seguro (http) a área de transferência não existe. O
      // link continua na tela, selecionável — dizer "copiado" seria mentir.
      toast.error(t("Não deu para copiar. Selecione o link e copie à mão."));
    }
  }

  if (!url) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={gerando || desabilitado}
        data-testid="btn-gerar-link-de-pareamento"
        onClick={() => void gerar()}
      >
        {gerando ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : null}
        {t("Enviar link para o cliente")}
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="link-de-pareamento">
      <p className="text-xs font-medium">{t("Link criado — vale por 30 min")}</p>
      {/*
        A URL INTEIRA, quebrando linha, e não um <input> de uma linha só. Num
        cartão estreito o campo cortava o endereço no meio (`…/pai…`), e o que
        sobrava tinha cara de texto de exemplo — foi relatado exatamente assim,
        "um link de placeholder". Ver o endereço completo é também como se
        confere que ele aponta para o domínio certo antes de mandar a alguém.
      */}
      <p
        className="select-all break-all rounded-md border bg-muted/40 p-2 font-mono text-xs"
        data-testid="url-do-pareamento"
      >
        {url}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void copiar()}>
          <Copy size={14} aria-hidden />
          {t("Copiar")}
        </Button>
        {/* Abrir numa aba nova é como quem envia confere que o link funciona
            ANTES de mandar — sem isso, o primeiro a descobrir que ele não abre
            é o cliente. `noopener` porque a página de destino é pública. */}
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t("Abrir")}
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("Qualquer pessoa com este link consegue parear um WhatsApp nesta linha.")}{" "}
        <button type="button" className="text-error-fg underline" onClick={() => void cancelar()}>
          {t("Cancelar link")}
        </button>
      </p>
    </div>
  );
}
