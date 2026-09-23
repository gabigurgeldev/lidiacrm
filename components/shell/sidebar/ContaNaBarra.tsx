"use client";
import Link from "next/link";
import { useTransition } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { cn } from "@/lib/utils";

/**
 * Quem está logado, no RODAPÉ DA BARRA — e a única saída da conta no produto.
 *
 * ⚠️ ISTO ERA `components/shell/header/ProfileMenu.tsx`, um avatar no canto
 * direito do cabeçalho. Desceu por decisão de quem é dono do produto, que quis o
 * cabeçalho com uma função só (buscar). O que NÃO podia acontecer junto está
 * escrito aqui porque é o tipo de coisa que some sem ninguém ver:
 *
 * `signOut()` só é chamado daqui. Não há item de logout na barra, não há em
 * Configurações (o mais perto é "encerrar todas as sessões", em Segurança, que é
 * outra coisa), e nenhuma spec de e2e exercita a saída da conta — medido. Ou
 * seja: se este componente sumisse, o CI ficaria VERDE e o produto ficaria sem
 * como sair da conta. Por isso a mudança de lugar e o nascimento no rodapé são o
 * mesmo commit, e por isso `tests/e2e/navegacao.spec.ts` passou a afirmar que a
 * conta está visível no rodapé em toda rota.
 *
 * ── Os dois estados ──────────────────────────────────────────────────────────
 *
 * Expandida, é uma linha com avatar, nome e e-mail, e o menu abre PARA CIMA
 * (`side="top"`): o rodapé está colado no fim da tela e um menu para baixo
 * nasceria fora dela. Estreita, sobra o avatar e o menu abre à direita, que é a
 * mesma direção dos tooltips dos itens — a barra inteira conversa para o mesmo
 * lado.
 *
 * ── Os links saem do REGISTRO ────────────────────────────────────────────────
 *
 * Pelo mesmo `canSee` que decide o menu. Escrever `/app/settings/profile` à mão
 * funcionaria hoje e seria a quinta lista de destinos do produto — a doença que
 * `lib/navigation/registry.ts` existe para curar. E não é zelo: Perfil e
 * Segurança são `viewer` hoje, mas um destino que amanhã suba de papel sumiria
 * daqui sozinho, em vez de virar um item que abre um 403.
 *
 * O menu mostra também a ORGANIZAÇÃO ativa — ela não aparece em lugar nenhum
 * para quem tem uma só (o `TenantSwitcher` devolve `null` nesse caso), e é a
 * informação que responde "estou mexendo na conta de quem?".
 */
function iniciais(nome: string | null, email: string): string {
  if (nome && nome.trim()) {
    return nome
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function ContaNaBarra({ compacto }: { compacto: boolean }) {
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
        {/* `nav-item` e não `Button`: no rodapé da barra esta linha é irmã de
            "Configurações", e as duas precisam ter a mesma altura, o mesmo raio
            e o mesmo hover. Um `Button variant="ghost"` traria a paleta do
            shadcn para dentro do escopo de token da casca. */}
        <button
          type="button"
          className={cn("nav-item nav-conta", compacto && "justify-center")}
          aria-label={t("Menu do usuário")}
          data-nav-focavel=""
        >
          <Avatar className="h-7 w-7 shrink-0">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
            <AvatarFallback className="text-[11px]">
              {iniciais(user.full_name, user.email)}
            </AvatarFallback>
          </Avatar>
          {/* `nav-rotulo` põe estes dois na MESMA regra que esconde o rótulo dos
              itens quando a barra estreita — por cookie ou por largura de tela.
              Sem isso, o rodapé seria o segundo lugar da barra a decidir
              compacto por conta própria, que é o defeito que o topo acabou de
              deixar de ter. */}
          <span className="nav-rotulo flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold leading-tight text-text">
              {user.full_name ?? user.email}
            </span>
            {/* ⚠️ A segunda linha só existe quando há NOME. Sem `full_name` — o
                caso de quem nunca abriu Configurações › Perfil, que é a maioria
                numa instalação nova — a primeira linha JÁ é o e-mail, e repeti-lo
                embaixo dava o mesmo endereço duas vezes, um em cima do outro.
                Visto na captura de 1440px da sonda. */}
            {user.full_name && (
              <span className="truncate text-[11px] font-normal leading-tight text-text-subtle">
                {user.email}
              </span>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compacto ? "right" : "top"}
        align={compacto ? "end" : "start"}
        sideOffset={8}
        className="nav-popover min-w-[248px] rounded-[14px] p-1.5"
      >
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
              <Icon size={16} weight="duotone" className="mr-2" aria-hidden />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        {atalhos.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="rounded-[8px]"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await signOut();
            })
          }
        >
          <SignOut size={16} weight="duotone" className="mr-2" aria-hidden />
          {t("Sair")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
