"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  contatoDaExecucao,
  nomeDoContato,
  useExecucoes,
  type ExecucaoDeFluxo,
} from "@/hooks/flows/useFlowExecutions";
import {
  NOME_DO_PASSO,
  segundosDesdeOPassoAnterior,
  useTrilhaDaExecucao,
} from "@/hooks/flows/useFlowExecutionTrail";
import { NOME_DO_ESTADO } from "@/app/app/flows/execucoes/_client";

/**
 * As execuções de UM fluxo, ao vivo.
 *
 * A tela global de execuções já existia e respondia "o que rodou". Ela não
 * respondia as duas perguntas que se faz olhando um fluxo específico: QUEM
 * disparou, e ONDE está agora. O contato já vinha do banco e não era mostrado;
 * a trilha por nó já era gravada e nenhuma tela a lia.
 */
export function ExecucoesDoFluxoClient({ flowId }: { flowId: string }) {
  const t = useT();
  const [aberta, setAberta] = useState<string | null>(null);
  const { data, isLoading } = useExecucoes({ flowId });
  const execucoes = data ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  }

  if (execucoes.length === 0) {
    return (
      <Card className="p-6" data-testid="execucoes-do-fluxo-vazio">
        <p className="text-sm text-muted-foreground">
          {t("Este fluxo ainda não rodou nenhuma vez.")}
        </p>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="execucoes-do-fluxo">
      {execucoes.map((e) => (
        <LinhaDaExecucao
          key={e.id}
          execucao={e}
          aberta={aberta === e.id}
          aoAlternar={() => setAberta(aberta === e.id ? null : e.id)}
        />
      ))}
    </ul>
  );
}

function LinhaDaExecucao({
  execucao,
  aberta,
  aoAlternar,
}: {
  execucao: ExecucaoDeFluxo;
  aberta: boolean;
  aoAlternar: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const contato = contatoDaExecucao(execucao);
  const nome = nomeDoContato(contato);
  const morreu = execucao.status === "dead";

  return (
    <li>
      <Card className="p-4" data-testid={`execucao-do-fluxo-${execucao.id}`}>
        <button
          type="button"
          onClick={aoAlternar}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            {/* O CONTATO em primeiro, e não o id da execução: a pergunta que se
                faz olhando esta tela é "quem disparou", não "qual uuid". */}
            <p className="truncate font-medium">
              {nome ?? t("Sem contato identificado")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {contato?.phone_number ?? execucao.lead?.title ?? ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Começou")} {new Date(execucao.started_at).toLocaleString(tag)} ·{" "}
              {execucao.steps_taken} {t("passos")}
            </p>
            {morreu && execucao.last_error !== null && (
              <p className="mt-1 text-xs text-error-fg" data-testid={`erro-${execucao.id}`}>
                {execucao.last_error}
              </p>
            )}
          </div>
          <Badge variant={morreu ? "destructive" : "secondary"}>
            {t(NOME_DO_ESTADO[execucao.status] ?? execucao.status)}
          </Badge>
        </button>

        {aberta && <Trilha execucaoId={execucao.id} />}
      </Card>
    </li>
  );
}

/**
 * O passo a passo, com o INTERVALO entre eles.
 *
 * O intervalo é o dado que torna a lentidão visível sem abrir o banco — foi
 * lendo exatamente isto que se mediu 59,1s numa retomada contra 0,1–0,9s entre
 * nós, e é o que prova, agora, que a retomada caiu para segundos.
 */
function Trilha({ execucaoId }: { execucaoId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading } = useTrilhaDaExecucao(execucaoId);
  const passos = data ?? [];

  if (isLoading) {
    return <p className="mt-3 text-xs text-muted-foreground">{t("Carregando…")}</p>;
  }
  if (passos.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">{t("Nenhum passo registrado ainda.")}</p>
    );
  }

  return (
    <ol className="mt-3 flex flex-col gap-1 border-t pt-3" data-testid={`trilha-${execucaoId}`}>
      {passos.map((p, i) => {
        const seg = segundosDesdeOPassoAnterior(passos, i);
        return (
          <li key={p.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-medium">{t(NOME_DO_PASSO[p.event_type] ?? p.event_type)}</span>
              {p.node_id !== null && (
                <span className="ml-2 font-mono text-muted-foreground">{p.node_id}</span>
              )}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {new Date(p.created_at).toLocaleTimeString(tag)}
              {seg !== null && ` · +${seg}s`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
