"use client";

import { differenceInMinutes, format, isSameDay } from "date-fns";
import Link from "next/link";
import * as React from "react";

import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

import { AvatarDaPessoa } from "./AvatarDaPessoa";
import { ALTURA_DA_HORA_PX, JANELA_DA_GRADE, repartirSobrepostos } from "./GradeDaAgenda";
import { corDaTrilha, fundoDaTrilha } from "./paleta";
import type { Agendamento, Pessoa } from "./tipos";

const HORAS = Array.from(
  { length: JANELA_DA_GRADE.ultima - JANELA_DA_GRADE.primeira + 1 },
  (_, i) => JANELA_DA_GRADE.primeira + i,
);

/** A régua é a MESMA da grade (`ALTURA_DA_HORA_PX`): um bloco de 30 min tem a mesma altura nas duas visões. */
function topoDe(d: Date): number {
  return (((d.getHours() - JANELA_DA_GRADE.primeira) * 60 + d.getMinutes()) / 60) * ALTURA_DA_HORA_PX;
}

/** Coluna de quem não está na lista — agendamento sem participante que ninguém reconhece. */
const SEM_PROFISSIONAL = "__sem_profissional__";

type Papel = "principal" | "apoio";

/**
 * O DIA POR PROFISSIONAL — uma coluna por pessoa, lado a lado.
 *
 * A semana responde "o que tem esta semana?"; esta visão responde a pergunta que
 * a recepção faz com o telefone na mão: "quem está livre às 15h?". Numa clínica
 * em que duas pessoas atendem em paralelo, a visão de dia empilha os blocos na
 * mesma coluna e a resposta exige ler cor por cor.
 *
 * ─── A APOIO aparece nas DUAS colunas ────────────────────────────────────
 *
 * Um procedimento com principal + apoio ocupa as duas pessoas (é a regra do
 * motor da 0245: o horário só é livre se as duas estiverem). Desenhar só na
 * coluna da principal faria a coluna da apoio parecer livre — e a recepção
 * ofereceria ao telefone um horário que o sistema recusaria. Na coluna da apoio
 * o bloco vem TRACEJADO e mais claro: ocupa, mas não é dela.
 *
 * Só leitura (mais o clique que abre o detalhe). Marcar clicando numa coluna
 * pediria a disponibilidade de cada profissional separada — uma consulta por
 * coluna —, e marcar pelo painel com a profissional escolhida já cobre o caso.
 */
export function GradePorProfissional({
  dia,
  agora,
  pessoas,
  agendamentos,
  onAbrirAgendamento,
  className,
}: {
  dia: Date;
  /** INJETADO, como na grade. */
  agora: Date;
  pessoas: Pessoa[];
  agendamentos: Agendamento[];
  onAbrirAgendamento?: (id: string) => void;
  className?: string;
}) {
  const t = useT();
  const doDia = React.useMemo(
    () => agendamentos.filter((a) => isSameDay(new Date(a.comeca), dia)),
    [agendamentos, dia],
  );

  const colunas = React.useMemo(() => {
    const ids = new Set(pessoas.map((p) => p.id));
    const porColuna = new Map<string, Array<{ agendamento: Agendamento; papel: Papel }>>();
    const pusher = (id: string, agendamento: Agendamento, papel: Papel) => {
      (porColuna.get(id) ?? porColuna.set(id, []).get(id)!).push({ agendamento, papel });
    };
    for (const a of doDia) {
      pusher(ids.has(a.responsavelId) ? a.responsavelId : SEM_PROFISSIONAL, a, "principal");
      if (a.apoioId && ids.has(a.apoioId)) pusher(a.apoioId, a, "apoio");
    }
    const lista: Array<{ id: string; pessoa: Pessoa | null }> = pessoas.map((p) => ({ id: p.id, pessoa: p }));
    if (porColuna.has(SEM_PROFISSIONAL)) lista.push({ id: SEM_PROFISSIONAL, pessoa: null });
    return lista.map((c) => ({ ...c, itens: porColuna.get(c.id) ?? [] }));
  }, [doDia, pessoas]);

  if (pessoas.length === 0) {
    return (
      <div
        data-testid="grade-por-profissional"
        data-vazia="true"
        className={cn("rounded-lg border border-border bg-surface p-6 text-sm text-text-muted", className)}
      >
        <p className="font-semibold text-text">{t("Nenhuma profissional cadastrada.")}</p>
        <p className="mt-1">{t("Cadastre quem atende para ver o dia de cada uma lado a lado.")}</p>
        <Link
          href="/app/settings/tenant/agenda/profissionais"
          className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
        >
          {t("Cadastrar profissionais")}
        </Link>
      </div>
    );
  }

  const ehHoje = isSameDay(dia, agora);
  const alturaDoCorpo = HORAS.length * ALTURA_DA_HORA_PX;

  return (
    <div
      data-testid="grade-por-profissional"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface", className)}
    >
      {/* A rolagem mora AQUI dentro, nas duas direções — com seis profissionais
          a largura passa da tela, e `html, body` têm `overflow-x: hidden`. */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky left-0 z-30 w-12 shrink-0 select-none border-r border-border bg-surface" aria-hidden>
          <div className="sticky top-0 z-30 h-10 border-b border-border bg-surface" />
          {HORAS.map((h) => (
            <div key={h} className="relative border-b border-border/50 text-right" style={{ height: ALTURA_DA_HORA_PX }}>
              <span className="absolute -top-1.5 right-1 text-[10px] tabular-nums text-text-subtle">
                {String(h).padStart(2, "0")}h
              </span>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1">
          {colunas.map(({ id, pessoa, itens }) => (
            <div
              key={id}
              data-testid={`coluna-profissional-${id}`}
              className="relative min-w-[140px] flex-1 border-r border-border last:border-r-0"
            >
              <div className="sticky top-0 z-20 flex h-10 items-center gap-1.5 border-b border-border bg-surface px-2">
                {pessoa ? (
                  <>
                    <AvatarDaPessoa pessoa={pessoa} tamanho="sm" />
                    <span className="truncate text-xs font-semibold text-text">{pessoa.nome}</span>
                  </>
                ) : (
                  <span className="truncate text-xs font-semibold text-text-muted">{t("Sem profissional")}</span>
                )}
              </div>
              <div className="relative" style={{ height: alturaDoCorpo }}>
                {HORAS.map((h) => (
                  <div key={h} className="border-b border-border/50" style={{ height: ALTURA_DA_HORA_PX }} />
                ))}
                <BlocosDaColuna itens={itens} pessoa={pessoa} pessoas={pessoas} onAbrir={onAbrirAgendamento} />
                {ehHoje ? (
                  <div
                    aria-hidden
                    data-testid={`regua-do-agora-${id}`}
                    className="pointer-events-none absolute inset-x-0 z-10 h-px bg-error"
                    style={{ top: topoDe(agora) }}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlocosDaColuna({
  itens,
  pessoa,
  pessoas,
  onAbrir,
}: {
  itens: Array<{ agendamento: Agendamento; papel: Papel }>;
  pessoa: Pessoa | null;
  pessoas: Pessoa[];
  onAbrir?: (id: string) => void;
}) {
  const t = useT();
  const papelDe = new Map(itens.map((i) => [i.agendamento.id, i.papel]));
  return (
    <>
      {repartirSobrepostos(itens.map((i) => i.agendamento)).map(({ agendamento: a, coluna, colunas }) => {
        const papel = papelDe.get(a.id) ?? "principal";
        const apoio = papel === "apoio";
        const doGoogle = a.origem === "google_sync";
        const cancelado = a.situacao === "cancelled";
        const comeca = new Date(a.comeca);
        const termina = new Date(a.termina);
        const duracao = Math.max(differenceInMinutes(termina, comeca), 15);
        // A cor é sempre a da PRINCIPAL: o bloco é dela, mesmo quando aparece
        // na coluna da apoio. Pintar com a cor da apoio faria o mesmo
        // compromisso ter duas cores na mesma tela.
        const trilha = pessoas.find((p) => p.id === a.responsavelId)?.trilha ?? pessoa?.trilha ?? 1;
        const principal = pessoas.find((p) => p.id === a.responsavelId);
        return (
          <button
            key={`${a.id}-${papel}`}
            type="button"
            data-testid={`bloco-profissional-${a.id}-${papel}`}
            data-papel={papel}
            data-origem={a.origem}
            disabled={doGoogle}
            onClick={doGoogle ? undefined : () => onAbrir?.(a.id)}
            aria-label={`${t(a.titulo)}, ${format(comeca, "HH:mm")} ${t("às")} ${format(termina, "HH:mm")}${
              a.quemSeraAtendido ? `, ${t("com")} ${a.quemSeraAtendido}` : ""
            }${apoio && principal ? `, ${t("apoio de")} ${principal.nome}` : ""}${
              doGoogle ? `, ${t("ocupado na agenda do Google")}` : ""
            }`}
            className={cn(
              "absolute flex flex-col items-start overflow-hidden rounded-sm px-1.5 py-0.5 text-left",
              "transition-colors duration-fast ease-out",
              doGoogle ? "cursor-default border border-border/60" : "cursor-pointer hover:border-border-strong",
              // TRACEJADO = ocupa esta pessoa, mas o compromisso é de outra.
              apoio ? "border border-dashed" : !doGoogle && "border border-border/60",
              cancelado && "pointer-events-none opacity-55",
            )}
            style={{
              top: topoDe(comeca),
              height: Math.max((duracao / 60) * ALTURA_DA_HORA_PX - 2, 18),
              left: `calc(${(coluna / colunas) * 100}% + 2px)`,
              width: `calc(${(1 / colunas) * 100}% - 4px)`,
              borderColor: apoio ? corDaTrilha(trilha) : undefined,
              background: doGoogle
                ? "repeating-linear-gradient(135deg, var(--color-surface-elevated) 0 6px, var(--color-surface) 6px 12px)"
                : fundoDaTrilha(trilha, apoio ? 6 : 12),
            }}
          >
            {!apoio && !doGoogle ? (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px] rounded-l-sm"
                style={{ backgroundColor: corDaTrilha(trilha) }}
              />
            ) : null}
            <span className="ml-1 truncate text-[11px] font-semibold leading-4 text-text">
              {a.quemSeraAtendido ?? t(a.titulo)}
            </span>
            {duracao >= 45 ? (
              <span className="ml-1 truncate text-[10px] leading-3 tabular-nums text-text-muted">
                {format(comeca, "HH:mm")}
                {apoio && principal ? ` · ${t("apoio de")} ${principal.nome}` : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
