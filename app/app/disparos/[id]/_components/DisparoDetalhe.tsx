"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import {
  useDestinatarios,
  useDisparo,
  type DestinatarioDaTela,
} from "@/hooks/bulk-send/useDisparos";
import { apiClient } from "@/lib/api/client";
import { CaretLeft, PaperPlaneTilt, Warning } from "@/lib/ui/icons";

/**
 * O DOSSIÊ — a tela que responde "deu certo?".
 *
 * Três coisas que ela faz e uma barra de progresso não faria:
 *
 *   1. Diz POR QUE parou, com a frase que o motor de ritmo gerou (hora e fuso
 *      inclusos), e leva a onde a régua se muda. Invariante 6: caminho visível
 *      de falha, nunca um `return` mudo.
 *   2. Dá um PRÓXIMO PASSO por motivo de não-envio. Invariante 4. E não oferece
 *      "tentar de novo" para quem pediu para parar — a proibição vem do dado
 *      (`tentarDeNovo`), não de um `if` desta tela.
 *   3. Separa PULADO de FALHOU. Pulado é decisão nossa sobre a pessoa e não se
 *      tenta de novo; falhou é do mundo e se tenta.
 */
export function DisparoDetalhe({ id, podeDisparar }: { id: string; podeDisparar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: d, isLoading } = useDisparo(id);
  const { data: destinatarios } = useDestinatarios(id);

  const acao = useMutation({
    mutationFn: async (rota: string) => apiClient.post(`/api/v1/bulk-sends/${id}/${rota}`, {}),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bulk-send", id] });
      qc.invalidateQueries({ queryKey: ["bulk-send-recipients", id] });
      qc.invalidateQueries({ queryKey: ["bulk-sends"] });
    },
  });

  if (isLoading || !d) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const c = d.contagens;
  const enviados = c.sent ?? 0;
  const falharam = c.failed ?? 0;
  const pulados = c.skipped ?? 0;
  const alvo = enviados + falharam + d.restantes;
  const progresso = alvo > 0 ? Math.round((enviados / alvo) * 100) : 0;

  const naoEnviados = (destinatarios ?? []).filter(
    (r) => r.status === "failed" || r.status === "skipped",
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/app/disparos"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeft className="size-4" />
          {t("Disparos")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1>
          <div className="flex gap-2">
            {podeDisparar && (d.status === "draft" || d.status === "scheduled") && (
              <Button onClick={() => acao.mutate("start")} disabled={acao.isPending}>
                <PaperPlaneTilt className="mr-2 size-4" />
                {t("Disparar para {n} pessoas").replace("{n}", String(d.restantes))}
              </Button>
            )}
            {podeDisparar && d.status === "running" && (
              <Button variant="outline" onClick={() => acao.mutate("pause")}>
                {t("Pausar")}
              </Button>
            )}
            {podeDisparar && d.status === "paused" && (
              <Button onClick={() => acao.mutate("resume")}>{t("Continuar")}</Button>
            )}
            {podeDisparar && ["draft", "scheduled", "running", "paused"].includes(d.status) && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm(t("Cancelar este disparo? Quem ainda não recebeu não vai receber."))) {
                    acao.mutate("cancel");
                  }
                }}
              >
                {t("Cancelar")}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Por que parou, e onde se resolve ────────────────────────────── */}
      {d.pausa && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <Warning className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t(d.pausa.titulo)}</p>
            <p className="text-sm text-muted-foreground">{t(d.pausa.proximoPasso)}</p>
            {/* A frase VERBATIM do motor de ritmo — com hora e fuso. A tela não
                a reescreve: uma segunda redação da mesma regra divergiria. */}
            {d.pause_detail && (
              <p className="text-xs text-muted-foreground">{d.pause_detail}</p>
            )}
            {d.pausa.abrirConexoes && (
              <Link
                href="/app/connections"
                className="w-fit text-sm font-medium underline underline-offset-4"
              >
                {t("Abrir Conexões")}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ─── Os números ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Contador rotulo={t("Enviados")} valor={enviados} />
          <Contador rotulo={t("Na fila")} valor={d.restantes} />
          <Contador rotulo={t("Falharam")} valor={falharam} destaque={falharam > 0} />
          <Contador rotulo={t("Fora da lista")} valor={pulados} />
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progresso}%` }} />
        </div>
        {d.restantes > 0 && d.status === "running" && (
          <p className="text-xs text-muted-foreground">
            {t("Pelo menos {m} minutos até a última mensagem.").replace(
              "{m}",
              String(Math.max(1, Math.ceil(d.previsao_minima_ms / 60000))),
            )}
          </p>
        )}
      </section>

      {/* ─── Quem não recebeu, e o que fazer ─────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">{t("Quem não recebeu")}</h2>
          {podeDisparar && falharam > 0 && (
            <Button variant="outline" size="sm" onClick={() => acao.mutate("retry-failed")}>
              {t("Tentar de novo os {n} que falharam").replace("{n}", String(falharam))}
            </Button>
          )}
        </div>

        {naoEnviados.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {enviados > 0
              ? t("Ninguém ficou de fora. Todos os {n} receberam.").replace(
                  "{n}",
                  String(enviados),
                )
              : t("Nada a mostrar ainda — o disparo não começou.")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {naoEnviados.map((r) => (
              <LinhaNaoEnviada key={r.id} destinatario={r} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Contador({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-2xl font-semibold ${destaque ? "text-destructive" : ""}`}>{valor}</p>
    </div>
  );
}

function LinhaNaoEnviada({
  destinatario: r,
  t,
}: {
  destinatario: DestinatarioDaTela;
  t: (s: string) => string;
}) {
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {r.nome ?? r.telefone ?? t("Contato sem nome")}
        </span>
        <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>
          {r.status === "failed" ? t("Falhou") : t("Fora da lista")}
        </Badge>
      </div>

      {/* Pulado: a frase e o próximo passo vêm do DADO. Falhou: a mensagem já
          chegou traduzida do motor. Em nenhum dos dois a tela mostra código. */}
      {r.motivo && (
        <>
          <p className="text-sm text-muted-foreground">{t(r.motivo.frase)}</p>
          <p className="text-xs text-muted-foreground">{t(r.motivo.proximoPasso)}</p>
        </>
      )}
      {r.erro && <p className="text-sm text-muted-foreground">{r.erro}</p>}

      {(r.motivo?.abrirContato ?? true) && (
        <Link
          href={`/app/contacts/${r.contact_id}`}
          className="w-fit text-xs font-medium underline underline-offset-4"
        >
          {t("Abrir o contato")}
        </Link>
      )}
    </li>
  );
}
