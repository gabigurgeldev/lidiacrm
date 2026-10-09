"use client";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { padraoParaPalavras, palavrasParaPadrao } from "@/lib/ai/agents/filtro-em-palavras";
import { problemaDoPadrao } from "@/lib/regex/segura";

export interface BusinessHoursValue {
  timezone: string;
  start: string;
  end: string;
  weekdays: number[];
}

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
  /** Membro de roteador: quem escolhe o agente é o roteador, e o filtro de assunto não vale. */
  roteador?: { routerName: string } | null;
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

export function TriggerEditor({ value, onChange, disabled, roteador }: Props) {
  const t = useT();
  // O padrão salvo é a fonte; a lista de palavras é só como a tela o mostra.
  // Padrão que não é lista de palavras abre direto no modo avançado.
  const palavrasIniciais = padraoParaPalavras(value.filters.keyword_regex);
  const [modoDoFiltro, setModoDoFiltro] = React.useState<"palavras" | "avancado">(
    palavrasIniciais === null ? "avancado" : "palavras",
  );
  const [textoDasPalavras, setTextoDasPalavras] = React.useState((palavrasIniciais ?? []).join(", "));
  const filtro = value.filters.keyword_regex;
  const problemaDoFiltro = filtro === null ? null : problemaDoPadrao(filtro);
  const palavrasDoFiltro = padraoParaPalavras(filtro);
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
      <div>
        <Label>{t("O que faz ele responder")}</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {(["message"] as const).map((ev) => {
            const checked = value.events.includes(ev);
            return (
              <label
                key={ev}
                className="flex cursor-pointer items-center gap-2 rounded border border-border/60 px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...value,
                      events: checked
                        ? (value.events.filter((e) => e !== ev) as TriggerValue["events"])
                        : ([...value.events, ev] as TriggerValue["events"]),
                    })
                  }
                  disabled={disabled}
                />
                {/* `message` é o nome do evento no wire; na tela vale o que ele
                    significa para quem lê. */}
                {ev === "message" ? t("Uma mensagem nova do cliente") : ev}
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={value.filters.ignore_groups}
            onCheckedChange={(v) => patchFilters({ ignore_groups: v })}
            disabled={disabled}
            id="ignore_groups"
          />
          <Label htmlFor="ignore_groups">{t("Não responder em grupos")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={value.filters.ignore_self}
            onCheckedChange={(v) => patchFilters({ ignore_self: v })}
            disabled={disabled}
            id="ignore_self"
          />
          <Label htmlFor="ignore_self">{t("Não responder às mensagens que saem do seu próprio número")}</Label>
        </div>
      </div>

      <div className="space-y-2" data-testid="filtro-de-assunto">
        <Label htmlFor={modoDoFiltro === "palavras" ? "filtro_palavras" : "keyword_regex"}>
          {t("Só responder sobre… (opcional)")}
        </Label>
        {roteador ? (
          <p className="rounded-md bg-accent-soft p-2 text-xs text-text-muted" data-testid="filtro-de-assunto-roteador">
            {t("Este agente é escolhido pelo roteador")} «{roteador.routerName}» —{" "}
            {t("lá quem decide o assunto é o roteador, e este filtro não vale.")}
          </p>
        ) : null}
        {modoDoFiltro === "palavras" ? (
          <Input
            id="filtro_palavras"
            value={textoDasPalavras}
            onChange={(e) => {
              setTextoDasPalavras(e.target.value);
              patchFilters({ keyword_regex: palavrasParaPadrao(e.target.value) });
            }}
            placeholder={t("Ex.: pedido, entrega, segunda via")}
            disabled={disabled}
          />
        ) : (
          <Input
            id="keyword_regex"
            value={filtro ?? ""}
            onChange={(e) =>
              patchFilters({ keyword_regex: e.target.value.trim() === "" ? null : e.target.value })
            }
            placeholder={t("Ex.: pedidos?|entrega|2a via")}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={problemaDoFiltro !== null && problemaDoFiltro !== "vazio"}
          />
        )}
        {problemaDoFiltro !== null && problemaDoFiltro !== "vazio" ? (
          <p className="text-xs text-destructive" role="alert" data-testid="filtro-de-assunto-erro">
            {problemaDoFiltro === "longo_demais"
              ? t("O filtro passou de 200 caracteres.")
              : problemaDoFiltro === "invalido"
                ? t("O filtro tem um erro de escrita (parêntese ou colchete sem par, por exemplo).")
                : problemaDoFiltro === "quantificador_aninhado"
                  ? t("O filtro repete um trecho que já se repete, como (a+)+. Isso pode travar o atendimento — simplifique.")
                  : t("O filtro usa referência a um trecho anterior. Isso não é aceito aqui.")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {modoDoFiltro === "palavras"
            ? t(
                "Em branco, ele responde a tudo. Preenchido, ele só entra numa conversa nova quando o cliente falar de uma dessas palavras (separe por vírgula; acento e maiúscula não importam). Conversa que ele já atende continua com ele.",
              )
            : t(
                "Expressão regular contra o que o cliente escreveu desde a última resposta, sem acento e em minúsculas.",
              )}
        </p>
        <button
          type="button"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || (modoDoFiltro === "avancado" && palavrasDoFiltro === null)}
          onClick={() => {
            if (modoDoFiltro === "palavras") {
              setModoDoFiltro("avancado");
              return;
            }
            setTextoDasPalavras((palavrasDoFiltro ?? []).join(", "));
            setModoDoFiltro("palavras");
          }}
        >
          {modoDoFiltro === "palavras"
            ? t("Usar expressão regular (avançado)")
            : palavrasDoFiltro === null
              ? t("Esta expressão não é uma lista de palavras")
              : t("Voltar para lista de palavras")}
        </button>
      </div>

      <div className="space-y-1">
        <Label>{t("Quantos atendimentos ao mesmo tempo")}</Label>
        <Select
          value={value.concurrency}
          onValueChange={(v) => onChange({ ...value, concurrency: v as TriggerValue["concurrency"] })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one_per_conversation">{t("Um de cada vez por conversa")}</SelectItem>
            <SelectItem value="one_per_contact">{t("Um de cada vez por cliente")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
