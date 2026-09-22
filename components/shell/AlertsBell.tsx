"use client";
import Link from "next/link";

import { useAgentInbox } from "@/hooks/ai/useAgentInbox";
import { useT } from "@/hooks/i18n/useT";
import { Bell } from "@/lib/ui/icons";

/**
 * Sino da central de avisos (Operação Visível F1): contador de avisos abertos
 * do runtime do agente no header; clique leva a /app/ai/inbox.
 *
 * ⚠️ A ALTURA ERA `h-11 lg:h-9` — 44px caindo para 36 — contra os 40px do item
 * da barra e da busca. Três alturas na mesma linha de 56px é exatamente o que o
 * comentário de `HeaderActions` dizia ter resolvido, e este era o que tinha
 * sobrado de fora. O ícone era 18 (tamanho que não existe na tabela de
 * `docs/design-system/05-iconography-phosphor.md:29-40`) e sem peso.
 *
 * As classes de cor eram aliases do shadcn (`text-muted-foreground`,
 * `hover:bg-muted`, `bg-destructive`). ⚠️ Isso NÃO estava pintando errado: o
 * bloco `.casca-escura` redefine os aliases junto com os tokens
 * (`app/globals.css:542-546`), então `--muted-foreground` já resolvia para
 * `--color-text-muted` ali dentro. A troca é de VOCABULÁRIO, não de correção —
 * o resto da casca fala em tokens do produto, e um dialeto só por superfície é
 * o que evita que a próxima pessoa precise descobrir qual dos dois vale aqui.
 * O contador segue em `--color-error`, que é o mesmo valor que `--destructive`
 * carrega neste escopo.
 */
export function AlertsBell() {
  const t = useT();
  const { data } = useAgentInbox("open");
  const count = data?.open_count ?? 0;

  return (
    <Link
      href="/app/ai/inbox"
      aria-label={
        count > 0
          ? `${t("Central de avisos")} — ${count} ${t("em aberto")}`
          : t("Central de avisos")
      }
      data-testid="alerts-bell"
      className="nav-sino relative inline-flex h-10 w-10 shrink-0 items-center justify-center"
    >
      <Bell size={20} weight="duotone" aria-hidden />
      {count > 0 ? (
        <span
          data-testid="alerts-bell-count"
          className="nav-sino-contador absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
