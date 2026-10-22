"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import type { ScheduleWindow } from "@/lib/schemas/routing";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";
import { Plus, Trash } from "@/lib/ui/icons";

/** Domingo = 0, como `scheduleWindowSchema.dow` e `Date.getDay()`. */
export const DIAS_DA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export interface JornadaEditavel {
  timezone: string;
  windows: ScheduleWindow[];
}

/**
 * A JORNADA SEMANAL — fuso e janelas — como um campo controlado.
 *
 * Extraído do `ScheduleDialog` de Equipe › Atendimento, que era o único lugar do
 * produto onde se publicava jornada. A migration 0245 criou o segundo: a tela de
 * Profissionais, onde a recepcionista publica os horários de quem NÃO tem login.
 * Duas cópias do mesmo editor divergiriam no primeiro ajuste (o seletor de fuso
 * validado, por exemplo, que existe porque `localMoment` LANÇA em fuso
 * inexistente) — então as duas telas montam este.
 *
 * Ele não salva nem sabe onde a jornada mora: quem tem login grava em
 * `attendant_availability`, quem não tem em `calendar_professionals.schedule`, e
 * quem decide é quem monta. Aqui é só o desenho e o estado.
 */
export function EditorDeJornada({
  valor,
  onChange,
  idDoFuso = "fuso-da-jornada",
  avisoSemJanelas,
}: {
  valor: JornadaEditavel;
  onChange: (proxima: JornadaEditavel) => void;
  /** `id` do seletor de fuso — duas instâncias na mesma tela precisam de ids distintos. */
  idDoFuso?: string;
  /** O que dizer quando não há janela nenhuma. Muda conforme a tela (roteamento × agenda). */
  avisoSemJanelas?: string;
}) {
  const t = useT();
  const { timezone, windows } = valor;
  const trocarJanelas = (proximas: ScheduleWindow[]) => onChange({ timezone, windows: proximas });

  return (
    <div className="space-y-4" data-testid="editor-de-jornada">
      <div className="space-y-1.5">
        <Label htmlFor={idDoFuso}>{t("Fuso horário")}</Label>
        {/* Lista FECHADA de fusos, e não texto livre: este valor é lido por
            `localMoment`, que LANÇA num fuso inexistente — e a pessoa com
            jornada quebrada nunca fica elegível nem recebe horário, sem que
            nada na tela diga por quê. */}
        <select
          id={idDoFuso}
          value={timezone}
          onChange={(e) => onChange({ timezone: e.target.value, windows })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {FUSOS_OFERECIDOS.map((f) => (
            <option key={f.codigo} value={f.codigo}>
              {f.rotulo} — {f.codigo}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {windows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="jornada-vazia">
            {avisoSemJanelas ?? t("Nenhuma janela publicada — ninguém consegue marcar com esta pessoa.")}
          </p>
        ) : null}
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2" data-testid={`janela-${i}`}>
            <Select
              value={String(w.dow)}
              onValueChange={(v) =>
                trocarJanelas(windows.map((x, j) => (j === i ? { ...x, dow: Number(v) } : x)))
              }
            >
              <SelectTrigger className="w-[90px]" aria-label={t("Dia da semana")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAS_DA_SEMANA.map((d, idx) => (
                  <SelectItem key={idx} value={String(idx)}>
                    {t(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              value={w.start}
              aria-label={t("Início")}
              onChange={(e) =>
                trocarJanelas(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
              }
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="time"
              value={w.end}
              aria-label={t("Fim")}
              onChange={(e) =>
                trocarJanelas(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Remover janela")}
              onClick={() => trocarJanelas(windows.filter((_, j) => j !== i))}
            >
              <Trash size={18} />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          data-testid="adicionar-janela"
          onClick={() => trocarJanelas([...windows, { dow: 1, start: "08:00", end: "18:00" }])}
        >
          <Plus size={16} className="mr-1" /> {t("Adicionar janela")}
        </Button>
      </div>
    </div>
  );
}

/** Resumo de uma linha ("Seg 08:00–18:00, Ter …"); "Não publicado" quando vazia. */
export function resumoDaJornada(windows: ScheduleWindow[], t: (texto: string) => string): string {
  if (windows.length === 0) return t("Não publicado");
  return windows.map((w) => `${t(DIAS_DA_SEMANA[w.dow] ?? "")} ${w.start}–${w.end}`).join(", ");
}
