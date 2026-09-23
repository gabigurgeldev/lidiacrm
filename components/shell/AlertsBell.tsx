"use client";
import Link from "next/link";

import { useAgentInbox } from "@/hooks/ai/useAgentInbox";
import { useT } from "@/hooks/i18n/useT";
import { Bell } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Sino da central de avisos (Operação Visível F1): contador de avisos abertos
 * do runtime do agente; clique leva a /app/ai/inbox.
 *
 * ── DUAS VARIANTES, UM SÓ CONTADOR ───────────────────────────────────────────
 *
 * `"icone"` é o quadrado de 40px do cabeçalho, e é o padrão. `"linha"` é a
 * linha de largura cheia do rodapé da barra, irmã de "Configurações".
 *
 * ⚠️ POR QUE A VARIANTE EXISTE, em vez de um componente novo ao lado. No Inbox
 * a casca NÃO desenha cabeçalho (`lib/navigation/casca.ts`), então o sino desce
 * para o rodapé — e lá ele era o quadrado de 40px no meio de linhas de largura
 * cheia: um ícone solto, sem rótulo, com um número vermelho flutuando, fora do
 * ritmo de tudo em volta. Um segundo componente resolveria a forma e duplicaria
 * o que importa: a leitura de `useAgentInbox`, a contagem, o `aria-label` que a
 * carrega e o `data-testid`. Duas fontes para o mesmo número é como um contador
 * passa a discordar de si mesmo.
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
export function AlertsBell({
  variante = "icone",
  compacto = false,
}: {
  variante?: "icone" | "linha";
  /**
   * Só faz sentido em `"linha"`: com a barra estreita o rótulo some por CSS e o
   * contador não tem para onde ir na direita, então ele volta a ser o
   * distintivo sobreposto ao ícone.
   */
  compacto?: boolean;
}) {
  const t = useT();
  const { data } = useAgentInbox("open");
  const count = data?.open_count ?? 0;
  const linha = variante === "linha";

  return (
    <Link
      href="/app/ai/inbox"
      aria-label={
        count > 0
          ? `${t("Central de avisos")} — ${count} ${t("em aberto")}`
          : t("Central de avisos")
      }
      data-testid="alerts-bell"
      className={cn(
        "relative",
        linha
          ? // `nav-item` e não um desenho próprio: no rodapé esta linha é irmã
            // de "Configurações", e as duas precisam da mesma altura, do mesmo
            // raio e do mesmo hover. É a mesma decisão de `ContaNaBarra`.
            "nav-item"
          : "nav-sino inline-flex h-10 w-10 shrink-0 items-center justify-center",
      )}
    >
      <Bell size={20} weight="duotone" className={cn(linha && "nav-icone shrink-0")} aria-hidden />
      {linha && <span className="nav-rotulo truncate">{t("Avisos")}</span>}
      {count > 0 ? (
        <span
          data-testid="alerts-bell-count"
          className={cn(
            "nav-sino-contador flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
            // Alinhado à direita quando há rótulo, sobreposto quando não há. É
            // o MESMO par que `ConnectionHealthDot` usa no item da barra
            // (`AppSidebar.tsx`) — um só jeito de pôr sinal num `nav-item`.
            linha && !compacto ? "ml-auto" : "absolute right-1 top-1",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
