"use client";
/**
 * VersionDiff — diff side-by-side de duas versions (S-13.12).
 *
 * Implementação intencionalmente simples (sem `react-diff-viewer`):
 *   - Tools: pills added/removed.
 *   - Provider/model/limits: lista de mudanças key→A/B.
 *   - System prompt: diff linha-a-linha de `lib/ui/diff-de-linhas.ts` (o mesmo
 *     da correção com IA), com marcadores `+`/`-`/` `.
 */
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import { diffDeLinhas } from "@/lib/ui/diff-de-linhas";

interface Props {
  versionA: AgentVersionRow; // mais antiga / base
  versionB: AgentVersionRow; // mais nova / candidata
}

function diffArr(prev: string[], next: string[]) {
  const added = next.filter((x) => !prev.includes(x));
  const removed = prev.filter((x) => !next.includes(x));
  return { added, removed };
}

interface FieldChange {
  key: string;
  label: string;
  a: unknown;
  b: unknown;
}

function buildFieldChanges(a: AgentVersionRow, b: AgentVersionRow): FieldChange[] {
  const fields: Array<[keyof AgentVersionRow, string]> = [
    ["provider", "Provider"],
    ["model", "Model"],
    ["channel_session_id", "Canal"],
    ["max_steps", "max_steps"],
    ["token_budget", "token_budget"],
    ["cost_budget_cents", "cost_budget_cents"],
    ["history_message_window", "history_message_window"],
    ["history_token_window", "history_token_window"],
    ["handoff_tool_enabled", "handoff_tool_enabled"],
    ["cases_enabled", "cases_enabled"],
    ["split_messages", "split_messages"],
    ["split_max_chars", "split_max_chars"],
    ["reply_as_audio", "reply_as_audio"],
    ["reply_as_audio_mirror", "reply_as_audio_mirror"],
    ["human_request_try_first", "human_request_try_first"],
    ["handoff_on_customer_image", "handoff_on_customer_image"],
    ["interactive_options_enabled", "interactive_options_enabled"],
    ["audio_voice", "audio_voice"],
  ];
  return fields
    .filter(([k]) => a[k] !== b[k])
    .map(([k, label]) => ({ key: k as string, label, a: a[k], b: b[k] }));
}

export function VersionDiff({ versionA, versionB }: Props) {
  const t = useT();
  const tools = diffArr(versionA.tool_ids ?? [], versionB.tool_ids ?? []);
  const handoffKw = diffArr(versionA.handoff_keywords ?? [], versionB.handoff_keywords ?? []);
  const followupFlows = diffArr(
    versionA.followup?.flow_pointer_ids ?? [],
    versionB.followup?.flow_pointer_ids ?? [],
  );
  const followupEnabledChanged =
    (versionA.followup?.enabled ?? false) !== (versionB.followup?.enabled ?? false);
  const fields = buildFieldChanges(versionA, versionB);
  const lines = diffDeLinhas(versionA.system_prompt ?? "", versionB.system_prompt ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline">v{versionA.version_number}</Badge>
        <span className="text-muted-foreground">→</span>
        <Badge variant="outline">v{versionB.version_number}</Badge>
      </div>

      <Section title={t("Configuração")}>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Sem mudanças.")}</p>
        ) : (
          // `overflow-x-auto` isolado: campos como `channel_session_id`
          // (uuid, monoespaçado) em 3 colunas passavam da largura de um
          // celular pequeno sem isso.
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3">{t("Campo")}</th>
                  <th className="py-1 pr-3">v{versionA.version_number}</th>
                  <th className="py-1">v{versionB.version_number}</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key} className="border-t border-border/40">
                    <td className="whitespace-nowrap py-1 pr-3 font-mono">{t(f.label)}</td>
                    <td className="whitespace-nowrap py-1 pr-3 font-mono text-destructive">{String(f.a)}</td>
                    <td className="whitespace-nowrap py-1 font-mono text-emerald-600">{String(f.b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("Capacidades")}>
        <Pills label={t("Adicionadas")} tone="add" items={tools.added} />
        <Pills label={t("Removidas")} tone="del" items={tools.removed} />
        {tools.added.length === 0 && tools.removed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Sem mudanças.")}</p>
        ) : null}
      </Section>

      <Section title={t("Handoff keywords")}>
        <Pills label={t("Adicionadas")} tone="add" items={handoffKw.added} />
        <Pills label={t("Removidas")} tone="del" items={handoffKw.removed} />
        {handoffKw.added.length === 0 && handoffKw.removed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Sem mudanças.")}</p>
        ) : null}
      </Section>

      <Section title={t("Follow-up")}>
        {followupEnabledChanged ? (
          <p className="text-xs">
            {t("Habilitado:")}{" "}
            <span className="font-mono text-destructive">
              {String(versionA.followup?.enabled ?? false)}
            </span>{" "}
            →{" "}
            <span className="font-mono text-emerald-600">
              {String(versionB.followup?.enabled ?? false)}
            </span>
          </p>
        ) : null}
        <Pills label={t("Fluxos adicionados")} tone="add" items={followupFlows.added} />
        <Pills label={t("Fluxos removidos")} tone="del" items={followupFlows.removed} />
        {!followupEnabledChanged &&
        followupFlows.added.length === 0 &&
        followupFlows.removed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Sem mudanças.")}</p>
        ) : null}
      </Section>

      <Section title={t("Instruções")}>
        <pre className="max-h-96 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-xs leading-relaxed">
          {lines.map((l, idx) => {
            const cls =
              l.kind === "add"
                ? "block bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : l.kind === "del"
                  ? "block bg-destructive/10 text-destructive"
                  : "block";
            const prefix = l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ";
            return (
              <span key={idx} className={cls}>
                {prefix}
                {l.text || " "}
              </span>
            );
          })}
        </pre>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Pills({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "add" | "del";
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {items.map((id) => (
        <Badge
          key={id}
          variant="outline"
          className={
            tone === "add"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }
        >
          {tone === "add" ? "+ " : "− "}
          {id}
        </Badge>
      ))}
    </div>
  );
}
