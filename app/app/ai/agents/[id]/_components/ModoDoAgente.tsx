"use client";
/**
 * "Como este agente trabalha" — atende clientes, só sugere respostas, ou pausado.
 *
 * O modo do meio (migration 0255) é o pedido de quem não quer a IA falando com
 * o cliente mas quer o "Sugerir resposta" do Inbox. Antes ele não existia: a
 * sugestão dependia do agente estar no ar, e pausar desligava as duas coisas —
 * o dono republicava para ter a sugestão de volta e o agente voltava a
 * responder no WhatsApp.
 *
 * Cada escolha chama a MESMA action que o menu da lista já usa
 * (`app/app/ai/agents/_actions.ts`), então não há segunda régua de transição.
 * Ir para "Atende clientes" pede confirmação: é o único gesto daqui que põe a
 * IA para falar com gente de verdade.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Grupo, Segmentado } from "@/components/ajustes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import type { AgentRow } from "@/hooks/ai/useAgent";

import { deriveAgentStatus } from "../../_components/AgentStatusBadge";
import { pauseAgentAction, soSugerirAgenteAction, unpauseAgentAction } from "../../_actions";
import { Bloco } from "./editor/pecas";

export type ModoDeTrabalho = "atendendo" | "so_sugestao" | "pausado";

/** O modo que a tela mostra, a partir do estado que o motor executa. `null` = não se aplica. */
export function modoDeTrabalho(agent: AgentRow): ModoDeTrabalho | null {
  // O `rag_bot` legado não tem versões: o modo do meio não existe para ele.
  if (agent.kind !== "mcp_agent") return null;
  switch (deriveAgentStatus(agent)) {
    case "published":
      return "atendendo";
    case "suggesting":
      return "so_sugestao";
    case "archived":
      return null;
    default:
      return "pausado";
  }
}

type Resultado = { ok: boolean; error?: string; message?: string };

export function ModoDoAgente({ agent, readOnly = false }: { agent: AgentRow; readOnly?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmarAtender, setConfirmarAtender] = useState(false);

  const atual = modoDeTrabalho(agent);
  if (atual === null) return null;

  const executar = (modo: ModoDeTrabalho) => {
    const passos: Record<ModoDeTrabalho, [string, () => Promise<Resultado>]> = {
      atendendo: [t("O agente voltou a atender clientes."), () => unpauseAgentAction(agent.id)],
      so_sugestao: [t("O agente agora só sugere respostas no Inbox."), () => soSugerirAgenteAction(agent.id)],
      pausado: [t("Agente pausado."), () => pauseAgentAction(agent.id)],
    };
    const [sucesso, acao] = passos[modo];
    startTransition(async () => {
      try {
        const res = await acao();
        if (res.ok) {
          toast.success(sucesso);
          router.refresh();
        } else {
          toast.error(res.message ? t(res.message) : `${t("Falha")}: ${res.error ?? "unknown"}`);
        }
      } catch {
        toast.error(t("Erro ao executar ação."));
      }
    });
  };

  const aoMudar = (modo: ModoDeTrabalho) => {
    if (modo === atual || isPending || readOnly) return;
    if (modo === "atendendo") {
      setConfirmarAtender(true);
      return;
    }
    executar(modo);
  };

  const explicacao: Record<ModoDeTrabalho, string> = {
    atendendo: t("Responde sozinho aos clientes no WhatsApp e também sugere respostas no Inbox."),
    so_sugestao: t(
      "Não fala com nenhum cliente. No Inbox, a equipe clica em Sugerir resposta, revisa o texto e envia.",
    ),
    pausado: t("Não atende clientes e não sugere respostas."),
  };

  return (
    <>
      <Grupo titulo={t("Como este agente trabalha")} rodape={explicacao[atual]} idDoTitulo="agente-modo-titulo">
        <Bloco testid="agente-modo">
          <Segmentado<ModoDeTrabalho>
            valor={atual}
            aoMudar={aoMudar}
            rotuloAcessivel={t("Como este agente trabalha")}
            desabilitado={isPending || readOnly}
            opcoes={[
              { valor: "atendendo", rotulo: t("Atende clientes"), testid: "agente-modo-atendendo" },
              { valor: "so_sugestao", rotulo: t("Só sugere respostas"), testid: "agente-modo-so-sugestao" },
              { valor: "pausado", rotulo: t("Pausado"), testid: "agente-modo-pausado" },
            ]}
          />
        </Bloco>
      </Grupo>

      <AlertDialog open={confirmarAtender} onOpenChange={setConfirmarAtender}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Colocar o agente para atender clientes?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "A partir de agora ele responde sozinho às mensagens que chegarem neste número de WhatsApp. As sugestões no Inbox continuam funcionando.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="agente-modo-confirmar-atender"
              onClick={() => {
                setConfirmarAtender(false);
                executar("atendendo");
              }}
            >
              {t("Atender clientes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
