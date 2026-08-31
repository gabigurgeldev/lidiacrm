"use client";

import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useDisparos, type DisparoDaLista } from "@/hooks/bulk-send/useDisparos";
import { PaperPlaneTilt, Plus } from "@/lib/ui/icons";
import { NovoDisparoDialog } from "./NovoDisparoDialog";

/**
 * A lista de disparos.
 *
 * Cada linha responde três coisas sem clique: em que pé está, quantos já
 * receberam, e — quando está parado — POR QUÊ. O "por quê" é o que separa esta
 * tela de uma barra de progresso: uma campanha que espera a janela de envio e
 * uma que travou por número desconectado parecem iguais no percentual, e pedem
 * ações opostas.
 */
const CORES: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  running: "default",
  paused: "destructive",
  done: "secondary",
  cancelled: "outline",
};

function rotuloDoEstado(status: string, t: (s: string) => string): string {
  const nomes: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendado",
    running: "Enviando",
    paused: "Parado",
    done: "Concluído",
    cancelled: "Cancelado",
  };
  return t(nomes[status] ?? status);
}

export function DisparosClient({ podeDisparar }: { podeDisparar: boolean }) {
  const t = useT();
  const { data: disparos, isLoading } = useDisparos();
  const [novoAberto, setNovoAberto] = React.useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const lista = disparos ?? [];

  return (
    <div className="flex flex-col gap-4">
      {podeDisparar && (
        <div className="flex justify-end">
          <Button onClick={() => setNovoAberto(true)}>
            <Plus className="mr-2 size-4" />
            {t("Novo disparo")}
          </Button>
        </div>
      )}

      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <PaperPlaneTilt className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">{t("Nenhum disparo ainda")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Um disparo manda a mesma mensagem para uma lista de contatos, espaçando os envios para o número não ser bloqueado pelo WhatsApp.",
            )}
          </p>
          {podeDisparar && (
            <Button variant="outline" onClick={() => setNovoAberto(true)}>
              {t("Criar o primeiro")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((d) => (
            <LinhaDoDisparo key={d.id} disparo={d} t={t} rotulo={rotuloDoEstado} />
          ))}
        </ul>
      )}

      <NovoDisparoDialog aberto={novoAberto} aoFechar={() => setNovoAberto(false)} />
    </div>
  );
}

function LinhaDoDisparo({
  disparo,
  t,
  rotulo,
}: {
  disparo: DisparoDaLista;
  t: (s: string) => string;
  rotulo: (s: string, t: (s: string) => string) => string;
}) {
  const c = disparo.contagens;
  const enviados = c.sent ?? 0;
  const falharam = c.failed ?? 0;
  const pulados = c.skipped ?? 0;
  const restantes = (c.pending ?? 0) + (c.sending ?? 0);
  const alvo = enviados + falharam + restantes;
  const progresso = alvo > 0 ? Math.round((enviados / alvo) * 100) : 0;

  return (
    <li className="rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <Link href={`/app/disparos/${disparo.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{disparo.name}</span>
          <Badge variant={CORES[disparo.status] ?? "outline"}>
            {rotulo(disparo.status, t)}
          </Badge>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progresso}%` }} />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{t("{n} enviados").replace("{n}", String(enviados))}</span>
          {restantes > 0 && <span>{t("{n} na fila").replace("{n}", String(restantes))}</span>}
          {falharam > 0 && (
            <span className="text-destructive">
              {t("{n} falharam").replace("{n}", String(falharam))}
            </span>
          )}
          {pulados > 0 && <span>{t("{n} fora da lista").replace("{n}", String(pulados))}</span>}
        </div>

        {/* O motivo da parada, na própria linha. Sem isto o operador precisa
            abrir cada campanha para descobrir qual delas precisa dele. */}
        {disparo.pause_detail && (
          <p className="text-xs text-amber-600 dark:text-amber-500">{disparo.pause_detail}</p>
        )}
      </Link>
    </li>
  );
}
