"use client";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";

export interface BusinessHoursValue {
  timezone: string;
  start: string;
  end: string;
  weekdays: number[];
}

/**
 * A forma gravada em `trigger_config`. A tela só EDITA o horário de
 * funcionamento — o resto passa intacto, para não reescrever dado de quem já
 * salvou. Os outros campos existiam como controles e nenhum mudava nada no
 * atendimento real (o motor canônico não os lê):
 *
 *  - `events`: só existe um evento, mensagem recebida;
 *  - `ignore_groups`: grupo NUNCA aciona o agente (`edge/crm/drain.ts`);
 *  - `ignore_self`: só mensagem RECEBIDA aciona o agente;
 *  - `concurrency`: a fila já atende um cliente por vez e junta a rajada;
 *  - `keyword_regex`: o motor não aplicava o filtro. Volta à tela quando ele
 *    funcionar de verdade.
 */
export interface TriggerValue {
  events: ("message")[];
  filters: {
    ignore_groups: boolean;
    ignore_self: boolean;
    keyword_regex: string | null;
    business_hours: BusinessHoursValue | null;
  };
  concurrency: "one_per_conversation" | "one_per_contact";
}

interface Props {
  value: TriggerValue;
  onChange: (v: TriggerValue) => void;
  disabled?: boolean;
}

const WEEKDAYS = [
  { id: 0, label: "Dom" },
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
];

export function TriggerEditor({ value, onChange, disabled }: Props) {
  const t = useT();
  function patchFilters(p: Partial<TriggerValue["filters"]>) {
    onChange({ ...value, filters: { ...value.filters, ...p } });
  }

  const bh = value.filters.business_hours;

  function setBhEnabled(enabled: boolean) {
    patchFilters({
      business_hours: enabled
        ? bh ?? {
            timezone: "America/Sao_Paulo",
            start: "08:00",
            end: "20:00",
            weekdays: [1, 2, 3, 4, 5],
          }
        : null,
    });
  }

  function patchBh(p: Partial<BusinessHoursValue>) {
    if (!bh) return;
    patchFilters({ business_hours: { ...bh, ...p } });
  }

  function toggleWeekday(d: number) {
    if (!bh) return;
    const has = bh.weekdays.includes(d);
    const next = has ? bh.weekdays.filter((x) => x !== d) : [...bh.weekdays, d].sort();
    patchBh({ weekdays: next });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-snug text-muted-foreground" data-testid="gatilho-explicacao">
        {t(
          "Ele responde às mensagens que os clientes mandam para o número dele. Mensagens seguidas do mesmo cliente viram uma resposta só. Grupos de WhatsApp e mensagens enviadas por você mesmo nunca acionam o agente.",
        )}
      </p>

      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={!!bh}
            onCheckedChange={setBhEnabled}
            disabled={disabled}
            id="bh_enabled"
          />
          <Label htmlFor="bh_enabled">{t("Só atender em horário de funcionamento")}</Label>
        </div>
        {bh ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="bh_tz">{t("Fuso horário")}</Label>
                <Input
                  id="bh_tz"
                  value={bh.timezone}
                  onChange={(e) => patchBh({ timezone: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bh_start">{t("Início")}</Label>
                <Input
                  id="bh_start"
                  type="time"
                  value={bh.start}
                  onChange={(e) => patchBh({ start: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bh_end">{t("Fim")}</Label>
                <Input
                  id="bh_end"
                  type="time"
                  value={bh.end}
                  onChange={(e) => patchBh({ end: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
            <div>
              <Label className="mb-1 block">{t("Dias")}</Label>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const active = bh.weekdays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleWeekday(d.id)}
                      disabled={disabled}
                      className={`rounded border px-2 py-1 text-xs ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {t(d.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
