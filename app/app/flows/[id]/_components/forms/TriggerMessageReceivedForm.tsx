"use client";

import { useT } from "@/hooks/i18n/useT";

import { SeletorDeCanal } from "./SeletorDeCanal";
import { Aviso, Secao, type PropsDoFormulario } from "./shared";

/**
 * `trigger.message_received` — toda mensagem de cliente serve, e agora dá para
 * dizer POR QUAIS NÚMEROS.
 *
 * O seletor existe aqui e no gatilho por palavra, nunca em um só: numa conta
 * com vários números conectados, o gatilho sem o campo dispara para todos sem
 * dizer, e quem configurou o outro acharia que os dois se comportam igual.
 */
export function TriggerMessageReceivedForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  return (
    <Secao>
      <Aviso
        texto={t(
          "Este fluxo começa sozinho toda vez que um cliente manda mensagem. Para reagir só a certas palavras, use o bloco de palavra-chave.",
        )}
      />

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por quais números o fluxo escuta")}
        </p>
        <SeletorDeCanal
          proposito="escuta"
          valor={(config.canal_id as string | null) ?? null}
          aoEscolher={(id) => mudar({ canal_id: id })}
        />
      </div>
    </Secao>
  );
}
