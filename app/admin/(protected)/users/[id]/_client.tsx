"use client";

import type { Locale } from "date-fns";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CaretLeft } from "@/lib/ui/icons";
import { useAdminUser } from "@/hooks/useAdminUser";
import { useMudarPapelAdmin, useReativarUsuarioAdmin } from "@/hooks/useAdminUserActions";
import {
  MenuDeAcoesDoUsuario,
  RemoverDaOrgDialog,
  SeloDeEstado,
  type AlvoDaAcao,
} from "@/components/admin/users/AcoesDeUsuario";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROTULO_DO_PAPEL } from "@/lib/auth/types";
import { ROLES, type Role } from "@/lib/schemas/team";
import { useT } from "@/hooks/i18n/useT";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_VARIANTS: Record<
  string,
  "success" | "info" | "warning" | "error" | "neutral"
> = {
  admin: "error",
  manager: "warning",
  agent: "info",
  viewer: "neutral",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  agent: "Agente",
  viewer: "Viewer",
};

function RoleBadge({ role }: { role: string }) {
  const t = useT();
  return (
    <Badge variant={ROLE_VARIANTS[role] ?? "neutral"}>
      {t(ROLE_LABELS[role] ?? role)}
    </Badge>
  );
}

function relativeDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: locale });
  } catch {
    return iso;
  }
}

function absoluteDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: locale });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface UserDetailClientProps {
  id: string;
}

export function UserDetailClient({ id }: UserDetailClientProps) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const { data, isLoading, isError } = useAdminUser(id);
  const router = useRouter();
  const reativar = useReativarUsuarioAdmin(id);
  const [removendo, setRemovendo] = useState<{ id: string; nome: string } | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (isError || !data?.data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <p className="text-sm font-medium">{t("Usuário não encontrado")}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/users">
            <CaretLeft size={14} aria-hidden />
            {t("Voltar")}
          </Link>
        </Button>
      </div>
    );
  }

  const { user, memberships, recent_audit } = data.data;
  const hasMfa = user.factors.some((f) => f.status === "verified");
  const alvo: AlvoDaAcao = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    status: user.status,
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <CaretLeft size={14} aria-hidden />
          {t("Usuários")}
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {user.full_name ?? user.email ?? t("Usuário sem nome")}
            </h1>
            <SeloDeEstado status={user.status} />
            {user.is_platform_admin && <Badge variant="info">{t("Admin da plataforma")}</Badge>}
          </div>
          {user.full_name && (
            <p className="font-mono text-sm text-muted-foreground">{user.email}</p>
          )}
          <p className="text-xs text-muted-foreground font-mono">{user.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user.status === "suspenso" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={reativar.isPending}
              onClick={() => reativar.mutate()}
              data-testid="detalhe-reativar"
            >
              {reativar.isPending ? t("Reativando...") : t("Reativar conta")}
            </Button>
          ) : null}
          <MenuDeAcoesDoUsuario
            alvo={alvo}
            onExcluido={() => router.push("/admin/users")}
          />
        </div>
      </div>

      {user.status === "suspenso" && (
        <div
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
          data-testid="banner-suspenso"
        >
          <p className="font-medium text-destructive">
            {t("Conta suspensa — esta pessoa não consegue entrar em nenhuma organização.")}
          </p>
          {user.suspensao && (
            <p className="mt-1 text-muted-foreground">
              {t("Motivo")}: {user.suspensao.motivo} · {absoluteDate(user.suspensao.em, localeDaData)}
            </p>
          )}
        </div>
      )}

      <Separator />

      {/* User info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("Informações do usuário")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">{t("Email confirmado")}</dt>
              <dd>{user.email_confirmed_at ? absoluteDate(user.email_confirmed_at, localeDaData) : <Badge variant="warning">{t("Pendente")}</Badge>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">{t("Último acesso")}</dt>
              <dd className="text-sm">{relativeDate(user.last_sign_in_at, localeDaData)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">{t("Criado em")}</dt>
              <dd className="text-sm">{absoluteDate(user.created_at, localeDaData)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground mb-0.5">MFA</dt>
              <dd>
                {hasMfa ? (
                  <Badge variant="success">{t("Ativo")}</Badge>
                ) : (
                  <Badge variant="neutral">{t("Inativo")}</Badge>
                )}
              </dd>
            </div>
            {user.phone && (
              <div>
                <dt className="text-xs text-muted-foreground mb-0.5">{t("Telefone")}</dt>
                <dd className="font-mono text-sm">{user.phone}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Memberships table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Memberships ({memberships.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {memberships.length === 0 ? (
            <p className="px-6 py-4 text-xs text-muted-foreground">
              {t("Sem memberships registrados.")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Organização")}</TableHead>
                  <TableHead className="w-[200px]">{t("Papel")}</TableHead>
                  <TableHead className="w-[140px]">{t("Aceito em")}</TableHead>
                  <TableHead className="w-[100px]">{t("Status")}</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((m) => (
                  <TableRow key={m.organization_id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Link
                          href={`/admin/tenants/${m.organization_id}`}
                          className="text-sm font-medium text-accent hover:underline"
                        >
                          {m.tenant_name ?? m.organization_id}
                        </Link>
                        {m.tenant_slug && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {m.tenant_slug}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.revoked_at ? (
                        <RoleBadge role={m.role} />
                      ) : (
                        <PapelNoVinculo userId={user.id} organizationId={m.organization_id} papel={m.role} />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {absoluteDate(m.accepted_at, localeDaData)}
                    </TableCell>
                    <TableCell>
                      {m.revoked_at ? (
                        <Badge variant="error">{t("Revogado")}</Badge>
                      ) : (
                        <Badge variant="success">{t("Ativo")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!m.revoked_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemovendo({ id: m.organization_id, nome: m.tenant_name ?? m.organization_id })}
                        >
                          {t("Remover")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent audit timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {t("Audit recente")} ({recent_audit.length}{recent_audit.length === 50 ? "+" : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent_audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("Nenhuma entrada de auditoria encontrada para este usuário.")}
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-auto pr-1">
              {recent_audit.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/50" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground">
                        {entry.action}
                      </span>
                      <span className="text-muted-foreground/60">
                        {format(new Date(entry.created_at), "dd/MM HH:mm:ss", {
                          locale: localeDaData,
                        })}
                      </span>
                    </div>
                    {entry.resource_type && (
                      <p className="text-muted-foreground/60">
                        {entry.resource_type}
                        {entry.resource_id ? ` · ${entry.resource_id.slice(0, 8)}…` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {removendo && (
        <RemoverDaOrgDialog
          alvo={alvo}
          organizacao={removendo}
          open
          onClose={() => setRemovendo(null)}
        />
      )}
    </div>
  );
}

/**
 * Papel da pessoa numa organização, editável direto na linha. As travas (último
 * admin, vínculo revogado) são do servidor; o 409 volta como toast e o select
 * volta ao valor real porque a query é invalidada.
 */
function PapelNoVinculo({
  userId,
  organizationId,
  papel,
}: {
  userId: string;
  organizationId: string;
  papel: string;
}) {
  const t = useT();
  const mudar = useMudarPapelAdmin(userId);
  return (
    <Select
      value={papel}
      disabled={mudar.isPending}
      onValueChange={(v) => mudar.mutate({ organizationId, role: v as Role })}
    >
      <SelectTrigger className="h-8 w-[180px] text-xs" aria-label={t("Papel nesta organização")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {t(ROTULO_DO_PAPEL[r])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
