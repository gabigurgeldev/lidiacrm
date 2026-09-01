"use client";
import Link from "next/link";
import { useTransition } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useUser } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { ShieldCheck, SignOut, UserCircle } from "@/lib/ui/icons";
import { canSee, NAV_DESTINATIONS } from "@/lib/navigation/registry";

function initials(name: string | null, email: string): string {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * Quem está logado, e os dois atalhos que se procura a partir do avatar.
 *
 * ⚠️ OS LINKS SAEM DO REGISTRO, e passam pelo MESMO `canSee` que decide o menu.
 * Escrever `/app/settings/profile` à mão aqui funcionaria hoje e seria a quinta
 * lista de destinos do produto — a doença que `lib/navigation/registry.ts`
 * existe para curar. Passar pelo `canSee` não é zelo excessivo: Perfil e
 * Segurança são `viewer` hoje, mas um destino que amanhã suba de papel sumiria
 * daqui sozinho, em vez de virar um item que abre um 403.
 *
 * O menu mostra também a ORGANIZAÇÃO ativa. Ela não aparecia em lugar nenhum
 * para quem tem uma organização só — o `TenantSwitcher` devolve `null` nesse
 * caso —, e é a informação que responde "estou mexendo na conta de quem?".
 */
export function ProfileMenu() {
  const t = useT();
  const user = useUser();
  const { signOut, activeOrg } = useAuth();
  const [isPending, startTransition] = useTransition();

  const podeVer = (href: string) => {
    const d = NAV_DESTINATIONS.find((x) => x.href === href);
    return d ? canSee(d, user.is_platform_admin, activeOrg?.role ?? null) : false;
  };

  const atalhos = [
    { href: "/app/settings/profile", label: t("Perfil"), icon: UserCircle },
    { href: "/app/settings/security", label: t("Segurança"), icon: ShieldCheck },
  ].filter((a) => podeVer(a.href));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          aria-label={t("Menu do usuário")}
        >
          <Avatar className="h-8 w-8">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
            <AvatarFallback className="text-[11px]">
              {initials(user.full_name, user.email)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nav-popover min-w-[248px] rounded-[14px] p-1.5">
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-semibold">{user.full_name ?? user.email}</span>
            <span className="truncate text-xs font-normal text-text-muted">{user.email}</span>
            {activeOrg?.name && (
              <span className="truncate pt-1 text-[11px] font-normal text-text-subtle">
                {activeOrg.name}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {atalhos.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild className="rounded-[8px]">
            <Link href={href}>
              <Icon size={16} className="mr-2" aria-hidden />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        {atalhos.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="rounded-[8px]"
          disabled={isPending}
          onClick={() => startTransition(async () => { await signOut(); })}
        >
          <SignOut size={16} className="mr-2" aria-hidden />
          {t("Sair")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
