"use client";

import { useQueryClient, type Query } from "@tanstack/react-query";
import * as React from "react";

import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

/**
 * As chaves que um compromisso novo, remarcado ou cancelado deixa VELHAS.
 *
 * Não `["agenda"]` inteiro: isso refaria também a lista de profissionais a cada
 * mudança de status de qualquer agendamento, e ela não depende disso. A grade
 * (`agendamentos`), os horários oferecidos (`horarios-livres`) e o detalhe aberto
 * (`detalhe`) dependem.
 */
const AFETADAS = new Set(["agendamentos", "horarios-livres", "detalhe"]);

function afetada(q: Query): boolean {
  const [raiz, ramo] = q.queryKey as unknown[];
  return raiz === "agenda" && typeof ramo === "string" && AFETADAS.has(ramo);
}

/**
 * A AGENDA AO VIVO — o compromisso que a IA marca numa conversa aparece na
 * grade de quem está olhando, sem recarregar.
 *
 * Sem isto, a feature de "a IA marca sozinha" tinha uma tela que só descobria a
 * marcação no F5: a recepcionista oferecia ao telefone o horário que a IA tinha
 * acabado de dar a outra pessoa, e o 409 do banco era o primeiro aviso.
 *
 * `calendar_appointments` está na publicação `supabase_realtime` desde a 0183, e
 * a RLS filtra do outro lado. O `filter` por `organization_id` é ESCOPO, não
 * segurança: quem é membro de duas organizações receberia a outra também, e a
 * tela invalidaria por mudança que ela não mostra.
 *
 * O evento não é aplicado no cache — ele só diz "algo mudou". Quem sabe o que a
 * tela deve mostrar é a rota (com o recorte, os participantes e o nome do
 * contato que o payload do Realtime não traz). E as rajadas viram UMA busca: a
 * IA que marca grava o agendamento e os participantes na mesma transação, e um
 * remarcar em lote emitiria uma invalidação por linha.
 *
 * Os participantes (`calendar_appointment_professionals`) NÃO estão na
 * publicação, e não precisam: eles nascem e mudam junto com o agendamento (a
 * função `fn_agenda_marcar` e o trigger de espelho da 0245), então o evento do
 * agendamento já cobre os dois.
 */
export function useAgendaAoVivo(organizationId: string | null) {
  const qc = useQueryClient();
  const espera = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (espera.current) clearTimeout(espera.current);
    },
    [],
  );

  const aoMudar = React.useCallback(() => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => {
      espera.current = null;
      void qc.invalidateQueries({ predicate: afetada });
    }, 300);
  }, [qc]);

  return useRealtimeChannel({
    name: `agenda-${organizationId ?? "sem-org"}`,
    enabled: organizationId !== null,
    postgresChanges: {
      event: "*",
      table: "calendar_appointments",
      ...(organizationId ? { filter: `organization_id=eq.${organizationId}` } : {}),
    },
    onChange: aoMudar,
  });
}
