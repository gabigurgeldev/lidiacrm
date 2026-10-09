"use client";
import { Campo, Grupo } from "@/components/ajustes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import type { CredentialRow, Provider } from "@/hooks/ai/useCredentials";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";

import { CredentialPicker } from "../CredentialPicker";
import { ModelPicker } from "../ModelPicker";
import type { PropsDaSecao } from "./estado";
import { Bloco, ErroDoCampo } from "./pecas";

export function SecaoInteligencia({
  form,
  patch,
  disabled,
  erros,
  credenciais,
  instalacaoTemChave,
  estadoDaCredencial,
}: PropsDaSecao & {
  credenciais: CredentialRow[];
  instalacaoTemChave: boolean;
  /** Estado da credencial escolhida; `null` = nenhuma ou a da instalação. */
  estadoDaCredencial: string | null;
}) {
  const t = useT();
  return (
    <Grupo titulo={t("A inteligência que ele usa")}>
      <Campo rotulo={t("Empresa de inteligência artificial")} htmlFor="provider">
        {/* Quando a empresa muda, chave e modelo são limpos: eles dependem dela. */}
        <Select
          value={form.provider}
          onValueChange={(v) => patch({ provider: v as Provider, credential_id: "", model: "" })}
          disabled={disabled}
        >
          <SelectTrigger id="provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/*
              Derivado de PROVEDORES, nunca escrito à mão: esta lista tinha três
              itens fixos enquanto o sistema executava quatro, e a OpenRouter — a
              opção [1] do instalador — não aparecia. Um agente publicado nela
              abria com o campo em BRANCO, porque nenhum item casava com o valor,
              e o primeiro save silencioso trocava o provedor do dono por outro.
            */}
            {PROVEDORES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
      <Bloco>
        <ModelPicker
          provider={form.provider}
          value={form.model}
          onChange={(modelId) => patch({ model: modelId })}
          disabled={disabled}
          id="model"
        />
        <ErroDoCampo texto={erros.model} />
      </Bloco>
      <Bloco>
        <CredentialPicker
          provider={form.provider}
          credentials={credenciais}
          value={form.credential_id}
          onChange={(id) => patch({ credential_id: id })}
          disabled={disabled}
          id="credential_id"
          instalacaoTemChave={instalacaoTemChave}
        />
        <ErroDoCampo texto={erros.credential_id} />
        {estadoDaCredencial !== null && estadoDaCredencial !== "validated" ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("Credencial selecionada está com status")} {estadoDaCredencial}
            {t(". Publicar fica bloqueado até validar.")}
          </p>
        ) : null}
      </Bloco>
    </Grupo>
  );
}
