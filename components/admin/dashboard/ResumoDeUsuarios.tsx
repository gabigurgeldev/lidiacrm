"use client";
/**
 * Faixa de usuários no Dashboard do painel da plataforma: o número de contas e
 * o que pede atenção (suspensos, inativos), com a porta para o relatório.
 *
 * Lê o MESMO endpoint do relatório (`/api/v1/admin/users/report`) e a mesma
 * chave de cache: abrir o relatório depois não refaz a varredura do diretório.
 * Falha em silêncio de propósito — o Dashboard é sobre a operação dos tenants,
 * e um Auth fora do ar já aparece na tela de Usuários com a mensagem certa.
 */
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useRelatorioDeUsuarios } from "@/hooks/useAdminUserActions";
import { ArrowRight, Users } from "@/lib/ui/icons";

export function ResumoDeUsuarios() {
  const t = useT();
  const { data, isLoading, isError } = useRelatorioDeUsuarios(30);
  if (isError) return null;
  const tot = data?.data.totais;

  const numeros: Array<{ rotulo: string; valor: number | undefined }> = [
    { rotulo: t("Usuários"), valor: tot?.usuarios },
    { rotulo: t("Ativos (30 dias)"), valor: tot?.ativos },
    { rotulo: t("Inativos"), valor: tot?.inativos },
    { rotulo: t("Suspensos"), valor: tot?.suspensos },
  ];

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
      aria-label={t("Resumo de usuários")}
      data-testid="resumo-de-usuarios"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Users size={20} weight="duotone" aria-hidden />
        </span>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:gap-8">
          {numeros.map((n) => (
            <div key={n.rotulo}>
              <dt className="text-xs text-muted-foreground">{n.rotulo}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {isLoading || n.valor === undefined ? <Skeleton className="h-6 w-10" /> : n.valor}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex gap-2">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          {t("Gerenciar")}
        </Link>
        <Link
          href="/admin/users/relatorios"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("Ver relatório")}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
