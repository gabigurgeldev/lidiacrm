"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { CaretRight } from "@/lib/ui/icons";
import { NAV_DESTINATIONS, NAV_GROUPS } from "@/lib/navigation/registry";

/**
 * Onde eu estou — derivado do REGISTRO, nunca de uma lista própria.
 *
 * O produto tinha um cabeçalho sem nenhuma indicação de posição: o nome da tela
 * só aparecia no `<h1>`, abaixo da dobra em qualquer página com filtro no topo.
 * A tentação óbvia era escrever um mapa de rota → título aqui. Seria a QUARTA
 * lista descrevendo o mesmo conjunto, e as três anteriores (menu, hub de
 * Configurações, abas de IA) divergiram até deixar sete telas inalcançáveis —
 * é a história que `lib/navigation/registry.ts` conta no próprio cabeçalho.
 *
 * Daqui não sai nome nenhum que o menu não conheça. Se um dia existir uma rota
 * fora do registro, este componente não desenha nada — e
 * `tests/unit/navegacao-completude.test.ts` já terá reprovado o CI antes disso
 * chegar na `main`.
 *
 * Prefixo mais LONGO, e não o primeiro que casa: `/app/settings/tenant/pipelines`
 * começa com `/app/settings`. Pelo primeiro casamento as Etapas do funil
 * apareceriam como "Organização / Configurações".
 */
export function Breadcrumb() {
  const t = useT();
  const pathname = usePathname();

  let destino: (typeof NAV_DESTINATIONS)[number] | null = null;
  for (const d of NAV_DESTINATIONS) {
    if (pathname !== d.href && !pathname.startsWith(d.href + "/")) continue;
    if (destino && destino.href.length >= d.href.length) continue;
    destino = d;
  }

  const grupo = destino ? NAV_GROUPS.find((g) => g.id === destino.group) : undefined;
  // Hubs não são destinos do registro (eles são do grupo), então `/app/ai` e
  // `/app/settings` caem aqui e recebem o próprio nome do hub.
  const hub = NAV_GROUPS.find((g) => g.hub?.href === pathname);

  if (!destino && !hub) return null;

  const folha = hub ? t(hub.hub!.label) : t(destino!.label);
  const raiz = hub ? t(hub.label) : grupo ? t(grupo.label) : null;
  const hrefDaRaiz = hub ? null : grupo?.hub?.href ?? null;

  return (
    <nav aria-label={t("Você está em")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {raiz && (
          // Some no celular: a régua ali é o polegar, e o grupo é a metade
          // menos informativa das duas. Some por CSS e não por JavaScript para
          // não haver uma medida de largura decidindo texto no primeiro render.
          <li className="hidden min-w-0 items-center gap-1.5 md:flex">
            {hrefDaRaiz ? (
              <Link
                href={hrefDaRaiz}
                className="truncate text-text-muted transition-colors hover:text-text"
              >
                {raiz}
              </Link>
            ) : (
              <span className="truncate text-text-muted">{raiz}</span>
            )}
            <CaretRight size={12} className="shrink-0 text-text-subtle" aria-hidden />
          </li>
        )}
        <li className="min-w-0">
          <span aria-current="page" className="truncate font-semibold text-text">
            {folha}
          </span>
        </li>
      </ol>
    </nav>
  );
}
