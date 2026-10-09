"use client";
import Link from "next/link";

import { Checkout, reaisDe } from "@/components/billing/Checkout";
import { MarcaDaBarra } from "@/components/shell/sidebar/SidebarBrand";
import { useT } from "@/hooks/i18n/useT";
import type { EstadoDeAcesso } from "@/lib/billing/acesso";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

/** A data no idioma de quem lê (`useTagDeIdioma`), nunca fixa em pt-BR. */
const dataCurtaNoIdioma = (iso: string | null, tag: string) =>
  iso ? new Date(iso).toLocaleDateString(tag, { day: "2-digit", month: "long" }) : "";

function Situacao({ estado }: { estado: EstadoDeAcesso }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const dataCurta = (iso: string | null) => dataCurtaNoIdioma(iso, tag);
  const bloqueado = !estado.liberado;
  const titulo =
    estado.motivo === "trial_vencido"
      ? t("Seu teste grátis terminou")
      : estado.motivo === "inadimplente"
        ? t("Pagamento pendente")
        : estado.motivo === "cancelada" && bloqueado
          ? t("Sua assinatura foi cancelada")
          : estado.motivo === "trial"
            ? `${t("Você está no teste grátis")} — ${estado.diasRestantes} ${estado.diasRestantes === 1 ? t("dia restante") : t("dias restantes")}`
            : estado.motivo === "tolerancia"
              ? t("Mensalidade vencida")
              : t("Sua assinatura");
  const texto = bloqueado
    ? t("O acesso ao CRM e as automações estão pausados. Seus dados continuam guardados — assim que o pagamento cair, tudo volta na hora.")
    : estado.motivo === "trial"
      ? t("Assine agora e não perca nenhum dia: a primeira cobrança só acontece no fim do teste.")
      : estado.motivo === "tolerancia"
        ? `${t("Regularize até")} ${dataCurta(estado.ateQuando)} ${t("para não ter o acesso pausado.")}`
        : t("Troque a forma de pagamento quando quiser.");

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={
        bloqueado || estado.motivo === "tolerancia"
          ? {
              background: "var(--color-warning-bg)",
              borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)",
            }
          : undefined
      }
      data-testid="situacao-da-assinatura"
      data-motivo={estado.motivo}
    >
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

export function TelaDeAssinatura({
  estado,
  organizacao,
  podePagar,
  email,
  valorCentavos,
}: {
  estado: EstadoDeAcesso;
  organizacao: string;
  podePagar: boolean;
  email: string;
  valorCentavos: number;
}) {
  const t = useT();
  const marca = useMarcaDaInstalacao();

  const inclui = [
    t("Atendimento no WhatsApp com agentes de IA"),
    t("CRM com funis, kanban e histórico do cliente"),
    t("Fluxos, follow-ups e disparos em massa"),
    t("Agenda, equipe e relatórios"),
  ];

  return (
    <div className="casca-moldura min-h-dvh w-full lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Painel do plano — a mesma moldura escura do app */}
      <aside className="casca-escura flex flex-col justify-between gap-10 px-6 py-8 text-text sm:px-10 lg:min-h-dvh lg:py-12">
        <div className="-mx-4">
          <MarcaDaBarra nome={marca.name} logoConfigurado={marca.logoUrl} collapsed={false} />
        </div>
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-subtle">{t("Plano")}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("CRM completo")}</h1>
          <p className="mt-6 flex items-baseline gap-1.5">
            <span className="text-5xl font-semibold tracking-tight tabular-nums" data-testid="preco">
              {reaisDe(valorCentavos)}
            </span>
            <span className="text-sm text-text-muted">/{t("mês")}</span>
          </p>
          <p className="mt-1 text-sm text-text-muted">{organizacao}</p>
          <ul className="mt-8 grid gap-3">
            {inclui.map((i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-text">{i}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-text-subtle">
          {t("Sem fidelidade. Cancele quando quiser — o acesso vale até o fim do mês pago.")}
        </p>
      </aside>

      {/* Pagamento */}
      <main className="bg-surface px-4 py-8 sm:px-10 lg:overflow-y-auto lg:rounded-tl-[var(--casca-raio)] lg:py-12">
        <div className="mx-auto grid w-full max-w-lg gap-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              {podePagar ? t("Pagamento") : t("Assinatura")}
            </h2>
            {estado.liberado ? (
              <Link href="/app" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                {t("Voltar ao CRM")}
              </Link>
            ) : (
              <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                {t("Sair")}
              </Link>
            )}
          </div>

          <Situacao estado={estado} />

          {podePagar ? (
            <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <Checkout emailInicial={email} />
            </div>
          ) : (
            <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground" data-testid="peca-ao-admin">
              {t("Só um administrador da organização pode assinar ou pagar. Peça a quem administra a conta para regularizar — o acesso volta na hora.")}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
