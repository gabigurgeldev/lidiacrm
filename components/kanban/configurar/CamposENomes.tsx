"use client";

import { useT } from "@/hooks/i18n/useT";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";
import type { PipelineConfigPatch } from "@/lib/schemas/settings";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { customFieldSchema, type CustomFieldDef } from "@/lib/schemas/settings";
import { Plus, Trash } from "@/lib/ui/icons";
export interface PipelineRow {
  id: string;
  name: string;
  vocabulary: { lead?: string; deal?: string; won?: string; lost?: string } | null;
  settings: Record<string, unknown> | null;
}

/**
 * Campos personalizados e nomes de um Kanban — a aba "Campos e nomes" do painel
 * Configurar (`ConfigurarKanban`). Veio da extinta página "Colunas dos
 * Kanbans" (2026-10-27). Admin: `updatePipelineConfig` recusa o resto.
 *
 * Os "motivos de perda por Kanban" saíram junto com a página: nada os lia —
 * `LoseLeadDialog` usa só `CANONICAL_LOST_REASONS` —, e um campo que se
 * edita e não muda nada é pior que campo nenhum. O valor antigo fica no banco
 * (o patch não manda `lost_reasons`, e a action faz merge).
 */
export function CamposENomes({ pipeline }: { pipeline: PipelineRow }) {
  const t = useT();
  const v = pipeline.vocabulary ?? {};
  const [lead, setLead] = useState(v.lead ?? "Lead");
  const [deal, setDeal] = useState(v.deal ?? "Deal");
  const [won, setWon] = useState(v.won ?? "Ganho");
  const [lost, setLost] = useState(v.lost ?? "Perdido");
  const [fields, setFields] = useState<CustomFieldDef[]>(camposDoFunil(pipeline.settings));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const ok: CustomFieldDef[] = [];
    for (const f of fields) {
      const parsed = customFieldSchema.safeParse(f);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? t("Campo inválido."));
        return;
      }
      ok.push(parsed.data);
    }
    const patch: PipelineConfigPatch = {
      vocabulary: { lead, deal, won, lost },
      fields: ok,
    };
    startTransition(async () => {
      const r = await updatePipelineConfig(pipeline.id, patch);
      if (r.ok) toast.success(`${pipeline.name} atualizado.`);
      else toast.error(`Erro: ${r.error}`);
    });
  }

  const TIPOS: CustomFieldDef["type"][] = [
    "text",
    "textarea",
    "number",
    "date",
    "boolean",
    "email",
    "phone",
    "url",
    "select",
  ];

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <h3 className="text-sm font-semibold">{t("Vocabulário e campos")}</h3>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">{t("Como chamar o cliente")}</Label>
          <Input value={lead} onChange={(e) => setLead(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("Como chamar o negócio")}</Label>
          <Input value={deal} onChange={(e) => setDeal(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("Quando fecha")}</Label>
          <Input value={won} onChange={(e) => setWon(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("Quando desiste")}</Label>
          <Input value={lost} onChange={(e) => setLost(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("Campos do lead neste Kanban")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("Aparecem no dossiê do negócio. No follow-up, você escolhe em qual campo gravar a resposta.")}
        </p>
        {fields.map((f, i) => (
          <div key={`${f.key}-${i}`} className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[1fr_1fr_8rem_auto]">
            <Input
              aria-label={`${t("Chave do campo")} ${i + 1}`}
              placeholder={t("chave (endereco)")}
              value={f.key}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, key: e.target.value };
                setFields(next);
              }}
            />
            <Input
              aria-label={`${t("Rótulo do campo")} ${i + 1}`}
              placeholder={t("Rótulo (Endereço)")}
              value={f.label}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, label: e.target.value };
                setFields(next);
              }}
            />
            <Select
              value={f.type}
              onValueChange={(type) => {
                const next = [...fields];
                next[i] = { ...f, type: type as CustomFieldDef["type"] };
                setFields(next);
              }}
            >
              <SelectTrigger aria-label={`${t("Tipo do campo")} ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {tipo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${t("Remover campo")} ${f.label || i + 1}`}
              onClick={() => setFields(fields.filter((_, j) => j !== i))}
            >
              <Trash size={14} aria-hidden />
            </Button>
            {f.type === "select" && (
              <Input
                className="md:col-span-3"
                aria-label={`${t("Opções do campo")} ${i + 1}`}
                placeholder={t("Opções, separadas por vírgula")}
                value={(f.options ?? []).map((o) => o.label).join(", ")}
                onChange={(e) => {
                  const options = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((label) => ({ value: label, label }));
                  const next = [...fields];
                  next[i] = { ...f, options };
                  setFields(next);
                }}
              />
            )}
          </div>
        ))}
        {fields.length < 50 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setFields([
                ...fields,
                { key: `campo_${fields.length + 1}`, label: t("Novo campo"), type: "text" },
              ])
            }
          >
            <Plus size={14} aria-hidden className="mr-1" /> {t("Adicionar campo")}
          </Button>
        )}
      </div>

      <div className="flex sm:justify-end">
        <Button onClick={handleSave} disabled={isPending} className="w-full sm:w-auto">
          {isPending ? t("Salvando…") : t("Salvar vocabulário e campos")}
        </Button>
      </div>
    </div>
  );
}
