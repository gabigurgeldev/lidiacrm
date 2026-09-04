"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { useT } from "@/hooks/i18n/useT";

/**
 * Derivado de `lib/ai/pontos/provedores.ts` — a mesma lista única da tela de
 * Credenciais e da rota. Como literal aqui, o seletor de modelo do agente não
 * conseguia representar um agente publicado em OpenRouter.
 */
export type Provider = (typeof PROVEDORES)[number]["id"];

export interface ModelOption {
  provider: Provider;
  model_id: string;
  display_name: string;
  context_window: number | null;
  is_default_for_provider: boolean;
}

interface Props {
  provider: Provider;
  value: string;
  onChange: (modelId: string, ctx?: { contextWindow: number | null }) => void;
  disabled?: boolean;
  id?: string;
  /**
   * Texto do estado "nada escolhido". Existe porque nem todo uso deste seletor
   * trata vazio como erro: no papel Operador, vazio SIGNIFICA "usa o mesmo
   * modelo que conversa", e chamar isso de "Selecione um modelo" mentiria.
   */
  placeholder?: string;
}

interface ApiResponse {
  data: { models: ModelOption[] };
}

const QUERY_KEY = (provider: Provider) => ["ai", "providers", provider, "models"] as const;

/**
 * O provedor tem catálogo sincronizável — hoje só a OpenRouter. Deriva do
 * MESMO array que a tela de Credenciais usa, e não de uma lista própria: duas
 * listas divergiriam na primeira vez que um provedor novo entrasse.
 */
function catalogoSincronizavel(provider: Provider): boolean {
  return PROVEDORES.find((p) => p.id === provider)?.catalogoSincronizavel ?? false;
}

export type EstadoDoPicker = "com_opcoes" | "erro" | "vazio_sem_sync" | "vazio_de_verdade";

/**
 * A decisão que este arquivo existe para acertar, isolada da árvore de JSX.
 *
 * Exportada e testada DIRETO, sem abrir o `<Select>`: o Radix não abre em
 * jsdom (`target.hasPointerCapture is not a function`) — mesma decisão de
 * `EdgeConfigPanel.test.tsx` e `PainelDoNo.paralelo.test.tsx`. Um teste que
 * dependesse do dropdown mediria o ambiente, não a regra.
 *
 * `models.length === 0` sozinho não diz NADA sobre a causa, e é exatamente
 * isso que colapsava três causas na mesma frase "Nenhum modelo disponível" —
 * medido em produção: OpenRouter com chave validada, catálogo global
 * (`ai_models`) com zero linhas porque o cron de sync nunca tinha rodado, e a
 * tela sem nenhuma pista do porquê.
 */
export function estadoDoPicker(input: {
  totalDeModelos: number;
  carregando: boolean;
  comErro: boolean;
  sincronizavel: boolean;
}): EstadoDoPicker {
  if (input.carregando) return "com_opcoes";
  if (input.comErro) return "erro";
  if (input.totalDeModelos > 0) return "com_opcoes";
  return input.sincronizavel ? "vazio_sem_sync" : "vazio_de_verdade";
}

export function ModelPicker({ provider, value, onChange, disabled, id, placeholder }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY(provider),
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });

  const sincronizar = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/ai/providers/${provider}/sync`, {}),
    onSuccess: () => {
      toast.success(t("Catálogo sincronizado."));
      void qc.invalidateQueries({ queryKey: QUERY_KEY(provider) });
    },
    onError: showApiError,
  });

  const models = query.data ?? [];
  const estado = estadoDoPicker({
    totalDeModelos: models.length,
    carregando: query.isLoading,
    comErro: query.isError,
    sincronizavel: catalogoSincronizavel(provider),
  });

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("Modelo")}</Label>
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          const m = models.find((m) => m.model_id === v);
          onChange(v, { contextWindow: m?.context_window ?? null });
        }}
        disabled={disabled || query.isLoading}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={query.isLoading ? t("Carregando…") : (placeholder ?? t("Selecione um modelo"))} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.model_id} value={m.model_id}>
              {m.display_name}
              {m.is_default_for_provider ? ` · ${t("default")}` : ""}
            </SelectItem>
          ))}
          {estado === "erro" ? (
            <SelectItem value="__erro__" disabled>
              {t("Não deu para carregar os modelos. Tente de novo.")}
            </SelectItem>
          ) : null}
          {estado === "vazio_de_verdade" ? (
            <SelectItem value="__none__" disabled>
              {t("Nenhum modelo disponível")}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {/*
        Fora do <Select> de propósito: um <SelectItem disabled> não aceita
        clique, então o botão de sincronizar não pode viver dentro do popover —
        precisaria fechar o popover pra depois clicar em outro lugar. Aqui ele
        aparece junto do campo, sempre visível quando o catálogo está vazio.
      */}
      {estado === "vazio_sem_sync" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("O catálogo desta conta ainda não foi sincronizado.")}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={sincronizar.isPending}
            onClick={() => sincronizar.mutate()}
          >
            {sincronizar.isPending ? t("Sincronizando…") : t("Sincronizar catálogo agora")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function useModelMeta(provider: Provider, modelId: string): ModelOption | null {
  const query = useQuery({
    queryKey: QUERY_KEY(provider),
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });
  return (query.data ?? []).find((m) => m.model_id === modelId) ?? null;
}
