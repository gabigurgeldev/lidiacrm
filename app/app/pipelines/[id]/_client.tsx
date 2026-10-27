"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/hooks/i18n/useT";
import { useBoard } from "@/hooks/kanban/useBoard";

function formatError(err: unknown, t: (texto: string) => string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";
      return `${obj.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return t("Erro desconhecido");
    }
  }
  return String(err);
}
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FilterBar } from "@/components/kanban/FilterBar";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { Button } from "@/components/ui/button";
import { Gear, Kanban as KanbanIcon, Plus } from "@/lib/ui/icons";
import { formatarReais } from "@/lib/kanban/dinheiro";
import { ConfigurarKanban, type AbaDeConfiguracao } from "@/components/kanban/configurar/ConfigurarKanban";
import type { LeadFilters } from "@/lib/kanban/filters";
import { applyFilters, filtersFromParams, filtersToParams } from "@/lib/kanban/filters";

export function PipelinePageClient({
  pipelineId,
  initialName,
  podeGerenciar = false,
  podeEditarCampos = false,
}: {
  pipelineId: string;
  initialName: string;
  /** Papel manager+ na organização ativa — o critério das rotas de etapa. */
  podeGerenciar?: boolean;
  /** Admin: campos personalizados e nomes (`updatePipelineConfig` recusa o resto). */
  podeEditarCampos?: boolean;
}) {
  const t = useT();
  const { data, isLoading, error, pulses, realtimeStatus, seguranca } = useBoard(pipelineId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: LeadFilters) => {
      const qs = filtersToParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  // `?configurar=colunas|campos` abre o painel direto — é o destino dos links
  // que antes levavam à página "Colunas dos Kanbans" (Painel de Evolução, agente).
  const abaDaUrl = searchParams.get("configurar");
  const configurando = podeGerenciar && (abaDaUrl === "colunas" || abaDaUrl === "campos");
  const abaAtual: AbaDeConfiguracao =
    abaDaUrl === "campos" && podeEditarCampos ? "campos" : "colunas";
  const abrirConfiguracao = useCallback(
    (aba: AbaDeConfiguracao | null) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (aba) qs.set("configurar", aba);
      else qs.delete("configurar");
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const filteredLeads = data ? applyFilters(data.leads, filters) : [];
  // Os números do topo leem o quadro INTEIRO (sem filtro): são o retrato do
  // Kanban, não da busca. Ganhos = fechados nos 30 dias que o GET traz.
  const numeros = useMemo(() => {
    if (!data) return null;
    let abertos = 0;
    let valorCents = 0;
    let ganhos = 0;
    for (const l of data.leads) {
      if (l.status === "open") {
        abertos += 1;
        valorCents += l.value_cents ?? 0;
      } else if (l.status === "won") {
        ganhos += 1;
      }
    }
    return { abertos, valorCents, ganhos };
  }, [data]);

  return (
    <div
      className="flex h-full flex-col gap-4"
      // OBSERVÁVEL de propósito, e é a razão de existir desta linha: "a
      // assinatura morreu" e "nada aconteceu" produzem o MESMO silêncio na
      // tela, e sem este valor nem o produto nem o teste conseguem separar as
      // duas famílias de causa. Com ele, quem investiga olha DURANTE a rodada
      // que falha: `subscribed` manda procurar a montante (entrega, filtro, ou
      // o evento nunca saiu); `channel_error`/`timed_out`/`closed` já é a
      // resposta.
      //
      // Ainda NÃO religa — religar é desenho e merece bloco próprio. Isto aqui
      // é só parar de descartar o que já era calculado.
      data-realtime-status={realtimeStatus.toLowerCase()}
      // A rede de segurança fica OBSERVÁVEL pelo mesmo motivo do status do
      // canal: "a entrega morreu" e "nada aconteceu" têm a mesma aparência, que
      // é silêncio. Aqui o número de divergências é a diferença entre os dois —
      // e é o sinal que faltava para uma verificação poder APROVAR, e não só
      // reprovar.
      data-refetch-divergencias={seguranca.divergencias}
      data-refetch-em={seguranca.ultimaVerificacao ?? ""}
    >
      {/* `flex-col` no mobile: nome de funil comprido (é texto livre, sem
          limite curto) + botão na mesma linha sem quebra empurrava o botão pra
          fora da viewport em telas estreitas. De `sm:` pra cima volta a ser
          uma linha só, como sempre foi. */}
      {/* Chassi em vidro: o cabeçalho é a ÚNICA superfície translúcida do quadro
          (vidro por coluna ou por card custaria GPU por elemento e travaria o
          arrasto — docs/design-system/09-anti-patterns.md). */}
      <header className="ios-vidro sticky top-0 z-20 flex flex-col gap-3 rounded-ios border border-border p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-ios-sm bg-accent-soft text-accent">
              <KanbanIcon size={22} weight="duotone" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {data?.pipeline.name ?? initialName}
              </h1>
              {numeros && (
                <p className="flex flex-wrap gap-x-3 text-xs text-text-muted" data-testid="numeros-do-kanban">
                  <span>
                    <strong className="font-semibold tabular-nums text-text">{numeros.abertos}</strong>{" "}
                    {numeros.abertos === 1 ? t("negócio aberto") : t("negócios abertos")}
                  </span>
                  <span>
                    <strong className="font-semibold tabular-nums text-text">{formatarReais(numeros.valorCents)}</strong>{" "}
                    {t("em aberto")}
                  </span>
                  <span>
                    <strong className="font-semibold tabular-nums text-success-fg">{numeros.ganhos}</strong>{" "}
                    {t("ganhos em 30 dias")}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          {podeGerenciar && (
            <Button
              variant="outline"
              onClick={() => abrirConfiguracao("colunas")}
              disabled={!data}
              data-testid="abrir-configurar-kanban"
            >
              <Gear size={16} className="mr-2" /> {t("Configurar")}
            </Button>
          )}
          <Button onClick={() => setNewOpen(true)} disabled={!data} className="shrink-0">
            <Plus size={16} className="mr-2" /> {t("Novo negócio")}
          </Button>
          </div>
        </div>
        <FilterBar filters={filters} onChange={setFilters} leads={data?.leads ?? []} />
      </header>
      {data && podeGerenciar && (
        <ConfigurarKanban
          pipeline={data.pipeline}
          aberto={configurando}
          aba={abaAtual}
          onAbaChange={(aba) => abrirConfiguracao(aba)}
          onOpenChange={(v) => abrirConfiguracao(v ? abaAtual : null)}
          podeEditarCampos={podeEditarCampos}
        />
      )}
      {data && (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipelineId={pipelineId}
          stages={data.stages}
        />
      )}
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {t("Não consegui carregar este Kanban:")} {formatError(error, t)}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">
          {t("Carregando…")}
        </div>
      ) : (
        <KanbanBoard
          pipelineId={pipelineId}
          stages={data.stages}
          leads={filteredLeads}
          pulses={pulses}
          pipeline={data.pipeline}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          leadInicial={searchParams.get("lead")}
          podeGerenciar={podeGerenciar}
        />
      )}
      <BulkActionBar
        selectedIds={selectedIds}
        stages={data?.stages ?? []}
        pipelineId={pipelineId}
        onClear={() => setSelectedIds([])}
      />
    </div>
  );
}
