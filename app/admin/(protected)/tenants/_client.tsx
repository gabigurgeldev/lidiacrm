"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/ui/icons";
import { TenantsFilters } from "@/components/admin/tenants/TenantsFilters";
import {
  TenantsTable,
  TenantsTableSkeleton,
} from "@/components/admin/tenants/TenantsTable";
import { useAdminTenants, type AdminTenantsFilters } from "@/hooks/useAdminTenants";
import { useT } from "@/hooks/i18n/useT";

export function TenantsClient() {
  const t = useT();
  const [filters, setFilters] = useState<AdminTenantsFilters>({});

  const { data, isLoading, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAdminTenants(filters);

  const rows = data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const total = rows.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Tenants")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading
              ? t("Carregando...")
              : isError
                ? t("Não foi possível carregar")
                : `${total} tenant${total !== 1 ? "s" : ""}${hasNextPage ? "+" : ""}`}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/admin/tenants/new">
            <Plus size={16} aria-hidden />
            {t("Novo tenant")}
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <TenantsFilters filters={filters} onChange={setFilters} />

      {/* Table */}
      {/*
        Erro NÃO é lista vazia. Antes, uma consulta que falhava caía aqui como
        "0 tenants / Nenhum tenant encontrado" — e quem administra a instalação
        concluía que não havia organização nenhuma.
      */}
      {isLoading ? (
        <TenantsTableSkeleton />
      ) : isError ? (
        <div
          role="alert"
          data-testid="tenants-erro"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm"
        >
          <p className="font-medium">{t("A lista de organizações não carregou.")}</p>
          <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            {t("Tentar de novo")}
          </Button>
        </div>
      ) : (
        <TenantsTable
          data={rows}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}
    </div>
  );
}
