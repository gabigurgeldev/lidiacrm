"use client";
/**
 * A lista de agentes, agrupada por número (`lib/ai/agents/lista-por-numero.ts`
 * explica o porquê e a ordem). Linguagem de Ajustes: um `Grupo` por número,
 * uma linha por agente — ver `components/ajustes`.
 */
import { useMemo, useState } from "react";
import Link from "next/link";

import { Grupo, Segmentado } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useAgentsList } from "@/hooks/ai/useAgents";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { agruparPorNumero, type GrupoDaLista, type NumeroDaLista } from "@/lib/ai/agents/lista-por-numero";
import { CaretRight, Robot, WhatsappLogo } from "@/lib/ui/icons";

import { AgentRowMenu } from "./AgentRowMenu";
import { AgentStatusBadge, deriveAgentStatus } from "./AgentStatusBadge";
import { modeloEmVigor, origemDoModelo } from "./modelo-em-vigor";

interface Props {
  initialData: AgentRow[];
  /** Números conectados da organização — os grupos da lista. */
  numeros?: NumeroDaLista[];
  canWrite: boolean;
}

type FiltroDeStatus = "todos" | "no_ar" | "rascunhos";

export function AgentsList({ initialData, numeros = [], canWrite }: Props) {
  const t = useT();
  const { data, isLoading } = useAgentsList({ initialData });
  const [status, setStatus] = useState<FiltroDeStatus>("todos");
  const [busca, setBusca] = useState("");
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  const agentes = useMemo(() => data ?? [], [data]);

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const visiveis = agentes.filter((a) => {
      const s = deriveAgentStatus(a);
      if (status === "no_ar" && s !== "published") return false;
      if (status === "rascunhos" && s !== "draft") return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const todos = agruparPorNumero(visiveis, numeros, {
      arquivado: (a) => deriveAgentStatus(a) === "archived",
      mostrarArquivados,
    });
    // Com filtro ou busca ativos, número vazio é ruído: ele some.
    return status === "todos" && q === "" ? todos : todos.filter((g) => g.agentes.length > 0);
  }, [agentes, numeros, status, busca, mostrarArquivados]);

  if (!isLoading && agentes.length === 0) {
    return (
      <Grupo testid="agentes-vazio">
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Robot size={36} aria-hidden className="text-muted-foreground" />
          <h2 className="font-medium">{t("Nenhum agente ainda")}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {canWrite
              ? t("Um agente responde às conversas do WhatsApp por você. Crie o primeiro com IA — você descreve o negócio e ele monta o resto.")
              : t("Quem administra a organização ainda não criou nenhum agente.")}
          </p>
        </div>
      </Grupo>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t("Buscar por nome…")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full sm:w-64"
          aria-label={t("Buscar agentes")}
        />
        <Segmentado
          rotuloAcessivel={t("Filtrar por situação")}
          valor={status}
          aoMudar={setStatus}
          opcoes={[
            { valor: "todos", rotulo: t("Todos") },
            { valor: "no_ar", rotulo: t("No ar") },
            { valor: "rascunhos", rotulo: t("Rascunhos") },
          ]}
          testid="agentes-filtro-status"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={mostrarArquivados} onCheckedChange={setMostrarArquivados} />
          {t("Mostrar arquivados")}
        </label>
      </div>

      {grupos.length === 0 ? (
        <p className="ios-grupo px-4 py-6 text-center text-sm text-muted-foreground">
          {t("Nenhum agente corresponde aos filtros.")}
        </p>
      ) : (
        grupos.map((g) => <GrupoDoNumero key={chaveDoGrupo(g)} grupo={g} canWrite={canWrite} />)
      )}
    </div>
  );
}

function chaveDoGrupo(g: GrupoDaLista<AgentRow>): string {
  return g.chave.tipo === "numero" ? g.chave.numero.id : g.chave.tipo;
}

function GrupoDoNumero({ grupo, canWrite }: { grupo: GrupoDaLista<AgentRow>; canWrite: boolean }) {
  const t = useT();
  const { chave, agentes } = grupo;
  const titulo =
    chave.tipo === "numero" ? (
      <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
        <WhatsappLogo size={14} weight="fill" aria-hidden className="text-success-fg" />
        <span className="font-semibold">{chave.numero.display_name}</span>
        {chave.numero.phone_number && chave.numero.phone_number !== chave.numero.display_name && (
          <span className="font-mono">{chave.numero.phone_number}</span>
        )}
      </span>
    ) : chave.tipo === "sem_numero" ? (
      t("Sem número no ar")
    ) : (
      t("Arquivados")
    );

  const rodape =
    chave.tipo === "numero" && agentes.length > 1
      ? t("Quem está em cima atende primeiro. Os de baixo só pegam a conversa se o de cima não aceitar o assunto.")
      : chave.tipo === "sem_numero"
        ? t("Rascunhos e agentes sem versão publicada não respondem ninguém.")
        : undefined;

  return (
    <Grupo titulo={titulo} rodape={rodape} recuo="icone" testid={`agentes-grupo-${chaveDoGrupo(grupo)}`}>
      {agentes.length === 0 ? (
        <div className="ios-linha text-sm text-muted-foreground" data-testid="numero-sem-agente">
          {t("Nenhum agente atende este número — as mensagens dele ficam só na Inbox.")}
        </div>
      ) : (
        agentes.map((a) => <LinhaDoAgente key={a.id} agent={a} canWrite={canWrite} />)
      )}
    </Grupo>
  );
}

function LinhaDoAgente({ agent, canWrite }: { agent: AgentRow; canWrite: boolean }) {
  const t = useT();
  const status = deriveAgentStatus(agent);
  return (
    <div className="ios-linha" data-clicavel="sim" data-testid="agente-linha">
      <span className="ios-disco" aria-hidden>
        <Robot size={20} weight="fill" />
      </span>
      <Link href={`/app/ai/agents/${agent.id}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{agent.name}</span>
          {agent.is_default && (
            <Badge variant="secondary" className="text-[10px]">
              {t("padrão")}
            </Badge>
          )}
        </span>
        <span
          className="mt-0.5 block truncate text-xs text-muted-foreground"
          title={
            origemDoModelo(agent) === "versao_publicada"
              ? t("Modelo da versão publicada — é o que atende o cliente.")
              : t("Modelo do cadastro; nenhuma versão publicada ainda.")
          }
        >
          {agent.description ? `${agent.description} · ` : ""}
          {modeloEmVigor(agent)}
        </span>
      </Link>
      <span className="flex flex-none items-center gap-1">
        <AgentStatusBadge status={status} />
        {canWrite && <AgentRowMenu agent={agent} />}
        <Link href={`/app/ai/agents/${agent.id}`} aria-label={t("Abrir agente")} className="p-1 text-muted-foreground">
          <CaretRight size={14} aria-hidden />
        </Link>
      </span>
    </div>
  );
}
