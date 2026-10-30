"use client";

import { format, isBefore } from "date-fns";
import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDetalheDoAgendamento } from "@/hooks/agenda/useDetalheDoAgendamento";
import { useRegistrarDesfecho } from "@/hooks/agenda/useRemarcarAgendamento";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { DetalheDoAgendamento as Detalhe } from "@/lib/agenda/contrato";
import {
  ROTULO_DA_SITUACAO,
  ROTULO_DO_AUTOR,
  SITUACOES_DO_AGENDAMENTO,
  type MotivoDeLembretePulado,
  type OrigemDoAgendamento,
  type SituacaoDoAgendamento,
} from "@/lib/agenda/tipos";
import { ApiError } from "@/lib/api/types";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { ChatCircle, Funnel, GoogleLogo, Robot, User } from "@/lib/ui/icons";

import { AvatarDaPessoa } from "./AvatarDaPessoa";
import { SELO_DA_ORIGEM } from "./profissionais-na-tela";
import type { Pessoa } from "./tipos";

/** O mesmo mapa do histórico: a situação tem UMA cor no produto inteiro. */
const VARIANTE_DA_SITUACAO: Record<SituacaoDoAgendamento, "default" | "neutral" | "success" | "warning" | "error"> = {
  confirmed: "default",
  pending: "warning",
  cancelled: "neutral",
  completed: "success",
  no_show: "error",
};

const ICONE_DA_ORIGEM: Record<OrigemDoAgendamento, typeof Robot> = {
  ui: User,
  mcp: Robot,
  google_sync: GoogleLogo,
  public_page: User,
};

/**
 * Por que o lembrete não saiu, na voz de quem lê — nunca o código.
 * `Record` exaustivo: motivo novo na 0245 sem frase aqui não compila.
 */
const MOTIVO_DO_LEMBRETE: Record<MotivoDeLembretePulado, string> = {
  marcado_em_cima_da_hora: "Sem lembrete — foi marcado em cima da hora.",
  sem_conversa: "Sem lembrete — o cliente não tem conversa por onde receber.",
  canal_exige_template: "Sem lembrete — o canal exige modelo aprovado fora da janela de 24 horas.",
  contato_bloqueado: "Sem lembrete — o cliente pediu para não receber mensagens.",
  enfileiramento_interrompido:
    "Lembrete incerto — o envio foi interrompido no meio. Confira na conversa se o cliente foi lembrado.",
};

function situacaoDe(valor: string): SituacaoDoAgendamento {
  return (SITUACOES_DO_AGENDAMENTO as readonly string[]).includes(valor)
    ? (valor as SituacaoDoAgendamento)
    : "confirmed";
}

/**
 * O AGENDAMENTO ABERTO — o que acontece quando se clica num card da grade.
 *
 * ─── O defeito que esta folha fecha ──────────────────────────────────────
 *
 * `GradeDaAgenda` aceitava `onAbrirAgendamento` desde que nasceu, e a tela do
 * produto não o passava: o card tinha cursor de mãozinha e o clique era MUDO. É
 * a segunda forma de controle decorativo, a que não fica cinza. Com a IA
 * marcando sozinha (0245), o clique virou a pergunta mais importante da tela —
 * "quem marcou isto, e em que conversa?" — e não tinha resposta.
 *
 * ─── O que ela responde ──────────────────────────────────────────────────
 *
 * Com quem, quem atende (principal e apoio), quando, em que situação, QUEM PÔS
 * AQUI (o selo de origem: IA, Tela, Google) e se o lembrete vai sair. E leva
 * aonde a conversa continua: o link da conversa onde a IA marcou e o do negócio
 * no funil. Um detalhe que só informa obriga a pessoa a procurar a conversa à
 * mão para responder ao cliente.
 *
 * As ações são as do histórico, com a mesma regra: remarcar e cancelar enquanto
 * o compromisso está de pé; realizado e faltou depois que a hora passou e o
 * desfecho não foi registrado; confirmar quando está aguardando.
 */
export function DetalheDoAgendamento({
  id,
  pessoas,
  agora,
  onFechar,
  onRemarcar,
  onCancelar,
  podeOperar = true,
}: {
  /** `null` = fechado. */
  id: string | null;
  /** Para a cor de cada profissional — a mesma trilha da grade. */
  pessoas: Pessoa[];
  /** INJETADO, como na grade. */
  agora: Date;
  onFechar: () => void;
  onRemarcar: (detalhe: Detalhe) => void;
  onCancelar: (detalhe: Detalhe) => void;
  /**
   * `false` para quem só olha (viewer): as ações somem em vez de devolver 403
   * no clique. A rota continua sendo quem decide — isto só não oferece o que
   * ela vai recusar.
   */
  podeOperar?: boolean;
}) {
  const t = useT();
  const { data, isLoading, isError, error } = useDetalheDoAgendamento(id);
  const naoExiste = isError && error instanceof ApiError && error.status === 404;

  return (
    <Sheet open={id !== null} onOpenChange={(aberto) => (aberto ? undefined : onFechar())}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        {isLoading ? (
          <div className="space-y-3" data-testid="detalhe-carregando">
            <SheetHeader>
              <SheetTitle>{t("Agendamento")}</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : data ? (
          <Conteudo
            detalhe={data}
            pessoas={pessoas}
            agora={agora}
            onRemarcar={onRemarcar}
            onCancelar={onCancelar}
            podeOperar={podeOperar}
          />
        ) : (
          <div data-testid="detalhe-indisponivel">
            <SheetHeader>
              <SheetTitle>{t("Agendamento")}</SheetTitle>
              <SheetDescription>
                {/* Desde a 0249 o 404 também é "é da agenda de um colega": o
                    atendente só vê a própria. A frase cobre os três casos sem
                    confirmar que o id existe. */}
                {naoExiste
                  ? t("Este agendamento não está na sua agenda — ele pode ser de um colega, de outra organização, ou ter sido removido.")
                  : t("Não consegui carregar este agendamento. Tente de novo em instantes.")}
              </SheetDescription>
            </SheetHeader>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  detalhe,
  pessoas,
  agora,
  onRemarcar,
  onCancelar,
  podeOperar,
}: {
  detalhe: Detalhe;
  pessoas: Pessoa[];
  agora: Date;
  onRemarcar: (detalhe: Detalhe) => void;
  onCancelar: (detalhe: Detalhe) => void;
  podeOperar: boolean;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const desfecho = useRegistrarDesfecho();
  const situacao = situacaoDe(detalhe.situacao);
  const comeca = new Date(detalhe.iniciaEm);
  const termina = new Date(detalhe.terminaEm);
  const dePe = situacao === "pending" || situacao === "confirmed";
  const jaComecou = isBefore(comeca, agora);
  const IconeDaOrigem = ICONE_DA_ORIGEM[detalhe.origem] ?? User;

  const lembrete = (() => {
    if (detalhe.lembrete.enviadoEm) {
      return t("Lembrete entregue à fila de mensagens em") +
        ` ${format(new Date(detalhe.lembrete.enviadoEm), t("d 'de' MMM 'às' HH:mm"), { locale: localeDaData })}.`;
    }
    const motivo = detalhe.lembrete.puladoPor as MotivoDeLembretePulado | null;
    if (motivo && motivo in MOTIVO_DO_LEMBRETE) return t(MOTIVO_DO_LEMBRETE[motivo]);
    if (situacao === "confirmed" && !jaComecou) return t("O lembrete sai automaticamente antes do horário, se o tipo tiver lembrete ligado.");
    return null;
  })();

  return (
    <div className="flex flex-col gap-5" data-testid="detalhe-do-agendamento" data-id={detalhe.id}>
      <SheetHeader>
        <SheetTitle className="pr-6">{detalhe.contato?.nome ?? t(detalhe.titulo)}</SheetTitle>
        <SheetDescription>
          {detalhe.tipo ? detalhe.tipo.nome : t(detalhe.titulo)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={VARIANTE_DA_SITUACAO[situacao]} data-testid="selo-situacao" data-situacao={situacao}>
          {t(ROTULO_DA_SITUACAO[situacao])}
        </Badge>
        {/* QUEM PÔS AQUI — em uma palavra, com o ícone. O rótulo longo do
            autor vai no `title` e na linha de baixo, para quem quer a frase. */}
        <Badge
          variant="neutral"
          data-testid="selo-origem"
          data-origem={detalhe.origem}
          title={t(ROTULO_DO_AUTOR[detalhe.autor])}
          className="gap-1"
        >
          <IconeDaOrigem size={12} weight="bold" aria-hidden />
          {t(SELO_DA_ORIGEM[detalhe.origem])}
        </Badge>
      </div>

      <section className="space-y-1" aria-label={t("Quando")}>
        <p className="text-sm font-semibold first-letter:uppercase">
          {format(comeca, t("EEEE, d 'de' MMMM"), { locale: localeDaData })}
        </p>
        <p className="text-sm tabular-nums text-text-muted">
          {format(comeca, "HH:mm")} – {format(termina, "HH:mm")}
          <span className="ml-2 text-[11px] text-text-subtle">{detalhe.fuso.replace("_", " ")}</span>
        </p>
      </section>

      {detalhe.contato ? (
        <section className="space-y-1" aria-label={t("Cliente")} data-testid="detalhe-cliente">
          <p className="text-xs font-medium text-text-muted">{t("Cliente")}</p>
          <p className="text-sm text-text">{detalhe.contato.nome ?? t("Sem nome")}</p>
          {detalhe.contato.telefone ? (
            <p className="text-xs tabular-nums text-text-subtle">{phoneForDisplay(detalhe.contato.telefone)}</p>
          ) : null}
        </section>
      ) : null}

      {detalhe.conversaId || detalhe.leadId ? (
        <div className="flex flex-wrap gap-2">
          {detalhe.conversaId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/inbox/${detalhe.conversaId}`} data-testid="link-da-conversa">
                <ChatCircle size={14} aria-hidden />
                {t("Abrir conversa")}
              </Link>
            </Button>
          ) : null}
          {detalhe.leadId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/leads/${detalhe.leadId}`} data-testid="link-do-lead">
                <Funnel size={14} aria-hidden />
                {t("Abrir negócio")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2" aria-label={t("Quem atende")} data-testid="detalhe-profissionais">
        <p className="text-xs font-medium text-text-muted">{t("Quem atende")}</p>
        {detalhe.profissionais.length === 0 ? (
          <p className="text-xs text-text-subtle">{t("Ninguém da equipe vinculado a este horário.")}</p>
        ) : (
          <ul className="space-y-1.5">
            {detalhe.profissionais.map((p) => {
              const naGrade = pessoas.find((x) => x.id === p.id);
              const pessoa: Pessoa = {
                id: p.id,
                nome: p.nome,
                trilha: naGrade?.trilha ?? p.trilha ?? 1,
              };
              return (
                <li key={p.id} className="flex items-center gap-2" data-testid={`profissional-${p.id}`} data-papel={p.papel}>
                  <AvatarDaPessoa pessoa={pessoa} tamanho="sm" />
                  <span className="text-sm text-text">{p.nome}</span>
                  <span className="text-[11px] text-text-subtle">
                    {p.papel === "apoio" ? t("apoio") : t("principal")}
                  </span>
                  {!p.ativo ? <span className="text-[11px] text-warning">{t("desativada")}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-text-muted" data-testid="detalhe-autor">
        {t(ROTULO_DO_AUTOR[detalhe.autor])}
      </p>

      {detalhe.notas ? (
        <section className="space-y-1" aria-label={t("Observações")}>
          <p className="text-xs font-medium text-text-muted">{t("Observações")}</p>
          <p className="whitespace-pre-wrap text-sm text-text">{detalhe.notas}</p>
        </section>
      ) : null}

      {situacao === "cancelled" && detalhe.motivoDoCancelamento ? (
        <section className="space-y-1 rounded-md border border-border bg-surface-sunken p-3" aria-label={t("Motivo do cancelamento")}>
          <p className="text-xs font-medium text-text-muted">{t("Motivo do cancelamento")}</p>
          <p className="text-sm text-text">{detalhe.motivoDoCancelamento}</p>
        </section>
      ) : null}

      {lembrete ? (
        <p className="text-xs leading-4 text-text-subtle" data-testid="detalhe-lembrete">
          {lembrete}
        </p>
      ) : null}

      {/* AS AÇÕES — a mesma regra do histórico, para as duas telas não
          discordarem sobre o que se pode fazer com o mesmo compromisso. */}
      {podeOperar ? (
      <div className="flex flex-wrap gap-2 border-t border-border pt-4" data-testid="acoes-do-agendamento">
        {situacao === "pending" ? (
          <Button
            size="sm"
            data-testid="acao-confirmar"
            disabled={desfecho.isPending}
            onClick={() => desfecho.mutate({ id: detalhe.id, status: "confirmed" })}
          >
            {t("Confirmar")}
          </Button>
        ) : null}
        {dePe && !jaComecou ? (
          <>
            <Button variant="outline" size="sm" data-testid="acao-remarcar" onClick={() => onRemarcar(detalhe)}>
              {t("Remarcar")}
            </Button>
            <Button variant="outline" size="sm" data-testid="acao-cancelar" onClick={() => onCancelar(detalhe)}>
              {t("Cancelar")}
            </Button>
          </>
        ) : null}
        {dePe && jaComecou ? (
          <>
            <Button
              variant="outline"
              size="sm"
              data-testid="acao-realizado"
              disabled={desfecho.isPending}
              onClick={() => desfecho.mutate({ id: detalhe.id, status: "completed" })}
            >
              {t("Realizado")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="acao-faltou"
              disabled={desfecho.isPending}
              onClick={() => desfecho.mutate({ id: detalhe.id, status: "no_show" })}
            >
              {t("Faltou")}
            </Button>
          </>
        ) : null}
        {!dePe ? (
          <p className="text-xs text-text-subtle">{t("Este agendamento já tem desfecho registrado.")}</p>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
