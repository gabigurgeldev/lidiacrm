"use client";
import { Grupo, LinhaInterruptor } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";

import { FollowupFlowPicker } from "../FollowupFlowPicker";
import type { PropsDaSecao } from "./estado";
import { Bloco } from "./pecas";

export function SecaoFollowup({ form, patch, disabled }: PropsDaSecao) {
  const t = useT();
  return (
    <Grupo
      titulo={t("Follow-up")}
      rodape={t(
        "Os fluxos abaixo só entram em ação para um cliente se este agente estiver publicado com follow-up habilitado.",
      )}
    >
      {/* O rótulo é o nome acessível que as specs de follow-up procuram. */}
      <LinhaInterruptor
        id="followup_enabled"
        titulo={t("Habilitar gatilhos automáticos de follow-up")}
        descricao={t("Retomar sozinho quem parou de responder, para o interessado não sumir sem ninguém perceber.")}
        ligado={form.followup.enabled}
        aoMudar={(v) => patch({ followup: { ...form.followup, enabled: v } })}
        desabilitado={disabled}
      />
      <Bloco>
        <FollowupFlowPicker
          value={form.followup.flow_pointer_ids}
          onChange={(ids) => patch({ followup: { ...form.followup, flow_pointer_ids: ids } })}
          disabled={disabled}
        />
      </Bloco>
    </Grupo>
  );
}
