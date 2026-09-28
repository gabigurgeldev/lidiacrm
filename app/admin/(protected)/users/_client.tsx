"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { CriarUsuarioDialog } from "@/components/admin/users/AcoesDeUsuario";
import {
  UsersTableAdmin,
  UsersTableAdminSkeleton,
} from "@/components/admin/users/UsersTableAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useAdminTenants } from "@/hooks/useAdminTenants";
import { useAdminUsers, type AdminUsersFilters } from "@/hooks/useAdminUsers";
import { ChartBar, DownloadSimple, UserPlus } from "@/lib/ui/icons";

/** Monta a URL do CSV com os MESMOS filtros da tela — o que se vê é o que se baixa. */
function urlDoExport(f: AdminUsersFilters): string {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  if (f.tenant_id) qs.set("tenant_id", f.tenant_id);
  if (f.role) qs.set("role", f.role);
  if (f.status) qs.set("status", f.status);
  const s = qs.toString();
  return `/api/v1/admin/users/export${s ? `?${s}` : ""}`;
}

export function UsersClient() {
  const t = useT();
  const [filters, setFilters] = useState<AdminUsersFilters>({});
  const [inputValue, setInputValue] = useState("");
  const [criando, setCriando] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: tenantsData } = useAdminTenants({});
  const tenants = (tenantsData?.pages ?? [])
    .flatMap((p) => p.data ?? [])
    .map((tn) => ({ id: tn.id, slug: tn.slug, display_name: tn.display_name }));

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAdminUsers(filters);

  const rows = data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const total = rows.length;

  const handleSearch = useCallback((value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, q: value || undefined }));
    }, 300);
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Usuários")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? t("Carregando...")
              : `${total}${hasNextPage ? "+" : ""} ${total !== 1 ? t("vínculos") : t("vínculo")} · ${t("uma linha por pessoa em cada organização")}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users/relatorios">
              <ChartBar size={16} weight="duotone" aria-hidden />
              {t("Relatórios")}
            </Link>
          </Button>
          {/* Download por navegação: a sessão vai no cookie, nenhuma credencial na URL. */}
          <Button asChild variant="outline" size="sm">
            <a href={urlDoExport(filters)} download data-testid="exportar-csv">
              <DownloadSimple size={16} weight="duotone" aria-hidden />
              {t("Exportar CSV")}
            </a>
          </Button>
          <Button
            size="sm"
            onClick={() => setCriando(true)}
            disabled={tenants.length === 0}
            data-testid="novo-usuario"
          >
            <UserPlus size={16} weight="duotone" aria-hidden />
            {t("Novo usuário")}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder={t("Buscar por email ou nome...")}
          value={inputValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="sm:w-72"
          aria-label={t("Buscar usuários")}
        />

        <Select
          value={filters.tenant_id ?? "all"}
          onValueChange={(v) =>
            setFilters((prev) => ({ ...prev, tenant_id: v === "all" ? undefined : v }))
          }
        >
          <SelectTrigger className="sm:w-52" aria-label={t("Filtrar por organização")}>
            <SelectValue placeholder={t("Organização")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todas as organizações")}</SelectItem>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.role ?? "all"}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              role: v === "all" ? undefined : (v as AdminUsersFilters["role"]),
            }))
          }
        >
          <SelectTrigger className="sm:w-44" aria-label={t("Filtrar por papel")}>
            <SelectValue placeholder={t("Papel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todos os papéis")}</SelectItem>
            <SelectItem value="admin">{t("Administrador")}</SelectItem>
            <SelectItem value="manager">{t("Gerente")}</SelectItem>
            <SelectItem value="agent">{t("Atendente")}</SelectItem>
            <SelectItem value="viewer">{t("Somente leitura")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              status: v === "all" ? undefined : (v as AdminUsersFilters["status"]),
            }))
          }
        >
          <SelectTrigger className="sm:w-40" aria-label={t("Filtrar por situação")} data-testid="filtro-status">
            <SelectValue placeholder={t("Situação")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todas as situações")}</SelectItem>
            <SelectItem value="ativo">{t("Ativo")}</SelectItem>
            <SelectItem value="suspenso">{t("Suspenso")}</SelectItem>
            <SelectItem value="pendente">{t("Nunca entrou")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <UsersTableAdminSkeleton />
      ) : (
        <UsersTableAdmin
          data={rows}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}

      {criando && (
        <CriarUsuarioDialog
          open
          onClose={() => setCriando(false)}
          organizacoes={tenants}
          organizacaoInicial={filters.tenant_id}
        />
      )}
    </div>
  );
}
