"use client";
import { Buildings } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * O aviso de que a tela opera ATRAVÉS das organizações — cada leitura aqui
 * enxerga dados de todos os tenants, e cada mutação sai auditada como
 * `acting_as_platform_admin`. Ele nunca some: é o que impede alguém de achar
 * que está na própria organização.
 *
 * Mora no cabeçalho escuro do painel (`AdminShell`), com os tokens de AVISO
 * (`--color-warning-*`) e não com âmbar fixo: o âmbar de antes era uma faixa
 * clara presa em cima da moldura escura, a única peça do painel que não
 * respeitava o tema.
 */
export function PlatformModeBanner() {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t("Modo Plataforma")}
      className="inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-1 text-xs"
      style={{
        background: "var(--color-warning-bg)",
        color: "var(--color-warning)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-warning) 35%, transparent)",
      }}
    >
      <Buildings size={14} weight="duotone" aria-hidden className="shrink-0" />
      <span className="font-semibold tracking-tight">{t("MODO PLATAFORMA")}</span>
      <span className="hidden truncate opacity-80 md:inline">{t("— operação cross-tenant")}</span>
    </div>
  );
}
