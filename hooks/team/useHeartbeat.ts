"use client";
import { useEffect } from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import { roleAtLeast } from "@/lib/auth/types";

/**
 * Ping de vida do atendente enquanto o app está aberto (AT-08).
 *
 * Sem ele, o cron `attendant-heartbeat` derrubava para offline TODO atendente
 * em até 20 min depois de ligar "Disponível" — nenhuma tela pingava. Montado na
 * casca do app, então vale em qualquer página, não só no inbox.
 *
 * Um ping por minuto deixa folga de sobra contra o corte de 15 min, mesmo com o
 * navegador estrangulando timers de aba em segundo plano (~1/min no Chrome).
 * Falha é silenciosa de propósito: o próximo ping tenta de novo, e um toast a
 * cada minuto de rede instável seria pior que o defeito.
 */
export const INTERVALO_DO_HEARTBEAT_MS = 60_000;

export function useHeartbeat(): void {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;
  const atende = roleAtLeast(activeOrg?.role, "agent");

  useEffect(() => {
    if (!orgId || !atende) return;
    const pingar = () => {
      apiClient.post("/api/v1/attendants/heartbeat", {}).catch(() => undefined);
    };
    pingar();
    const id = window.setInterval(pingar, INTERVALO_DO_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [orgId, atende]);
}
