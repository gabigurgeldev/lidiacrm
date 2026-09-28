"use client";
import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

import {
  BarrasHorizontais,
  CartaoDeGrafico,
  SerieDiaria,
} from "@/components/admin/users/GraficosDeUsuarios";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useRelatorioDeUsuarios } from "@/hooks/useAdminUserActions";
import { ROTULO_DO_PAPEL } from "@/lib/auth/types";
import { ROLES } from "@/lib/schemas/team";
import { CaretLeft, DownloadSimple } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const PERIODOS = [7, 30, 90] as const;

function Indicador({
  rotulo,
  valor,
  detalhe,
  tom = "normal",
  testId,
}: {
  rotulo: string;
  valor: number;
  detalhe?: string;
  tom?: "normal" | "alerta";
  testId?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums tracking-tight",
          tom === "alerta" && valor > 0 && "text-destructive",
        )}
      >
        {valor.toLocaleString("pt-BR")}
      </p>
      {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

export function RelatorioDeUsuariosClient() {
  const t = useT();
  const locale = useLocaleDeData();
  const [dias, setDias] = useState<(typeof PERIODOS)[number]>(30);
  const { data, isLoading, isError, refetch } = useRelatorioDeUsuarios(dias);
  const r = data?.data;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} aria-hidden />
        {t("Usuários")}
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Relatórios de usuários")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Todas as contas da instalação, com ou sem organização.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("Período")} className="inline-flex rounded-lg border p-0.5">
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDias(p)}
                aria-pressed={dias === p}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  dias === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p} {t("dias")}
              </button>
            ))}
          </div>
          <Button asChild variant="outline" size="sm">
            <a href="/api/v1/admin/users/export" download>
              <DownloadSimple size={16} weight="duotone" aria-hidden />
              {t("Exportar CSV")}
            </a>
          </Button>
        </div>
      </header>

      {isError ? (
        <div className="rounded-xl border p-8 text-center">
          <p className="text-sm font-medium">{t("Não consegui montar o relatório agora.")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            {t("Tentar de novo")}
          </Button>
        </div>
      ) : isLoading || !r ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador
              rotulo={t("Usuários")}
              valor={r.totais.usuarios}
              detalhe={t("contas na instalação")}
              testId="kpi-usuarios"
            />
            <Indicador
              rotulo={t("Ativos")}
              valor={r.totais.ativos}
              detalhe={t("entraram nos últimos 30 dias")}
              testId="kpi-ativos"
            />
            <Indicador
              rotulo={t("Inativos")}
              valor={r.totais.inativos}
              detalhe={t("sem entrar há 30+ dias")}
              testId="kpi-inativos"
            />
            <Indicador rotulo={t("Suspensos")} valor={r.totais.suspensos} tom="alerta" testId="kpi-suspensos" />
            <Indicador rotulo={t("Nunca entraram")} valor={r.totais.pendentes} />
            <Indicador rotulo={t("Sem verificação em 2 etapas")} valor={r.totais.sem_mfa} />
            <Indicador rotulo={t("E-mail não confirmado")} valor={r.totais.email_nao_confirmado} />
            <Indicador
              rotulo={t("Sem organização")}
              valor={r.totais.sem_organizacao}
              detalhe={t("conta sem acesso a nada")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CartaoDeGrafico titulo={t("Novas contas por dia")} subtitulo={`${dias} ${t("dias")}`}>
              <SerieDiaria
                rotulo={t("cadastros")}
                dados={r.serie.map((s) => ({ dia: s.dia, valor: s.cadastros }))}
              />
            </CartaoDeGrafico>
            <CartaoDeGrafico
              titulo={t("Último acesso por dia")}
              subtitulo={t("Quantas pessoas tiveram o acesso mais recente em cada dia")}
            >
              <SerieDiaria
                rotulo={t("pessoas")}
                dados={r.serie.map((s) => ({ dia: s.dia, valor: s.acessos }))}
              />
            </CartaoDeGrafico>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CartaoDeGrafico
              titulo={t("Por papel")}
              subtitulo={t("Acessos ativos. Quem está em duas organizações conta duas vezes.")}
            >
              <BarrasHorizontais
                vazio={t("Nenhum acesso ativo.")}
                itens={[...ROLES].reverse().map((papel) => ({
                  chave: papel,
                  rotulo: t(ROTULO_DO_PAPEL[papel]),
                  valor: r.por_papel[papel],
                }))}
              />
            </CartaoDeGrafico>
            <CartaoDeGrafico titulo={t("Organizações com mais pessoas")} subtitulo={t("As 10 maiores")}>
              <BarrasHorizontais
                vazio={t("Nenhuma organização com pessoas.")}
                itens={r.por_organizacao.map((o) => ({
                  chave: o.organization_id,
                  rotulo: o.nome ?? o.organization_id,
                  valor: o.usuarios,
                  href: `/admin/tenants/${o.organization_id}`,
                }))}
              />
            </CartaoDeGrafico>
          </div>

          <CartaoDeGrafico
            titulo={t("Há mais tempo sem entrar")}
            subtitulo={t("Candidatos a revisão: quem nunca entrou aparece primeiro.")}
          >
            {r.inativos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("Todo mundo entrou recentemente.")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">{t("Pessoa")}</th>
                      <th className="pb-2 font-medium">{t("Último acesso")}</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {r.inativos.map((u) => (
                      <tr key={u.id} className="border-t">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{u.full_name ?? u.email}</p>
                          {u.full_name && (
                            <p className="font-mono text-xs text-muted-foreground">{u.email}</p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {u.last_sign_in_at
                            ? formatDistanceToNow(new Date(u.last_sign_in_at), { addSuffix: true, locale })
                            : t("Nunca entrou")}
                        </td>
                        <td className="py-2 text-right">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="text-xs font-medium text-accent hover:underline"
                          >
                            {t("Abrir")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CartaoDeGrafico>
        </>
      )}
    </div>
  );
}
