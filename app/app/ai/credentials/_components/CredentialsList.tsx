"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Grupo } from "@/components/ajustes";
import { Plus } from "@/lib/ui/icons";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { useCredentialsList, type CredentialRow, type Provider } from "@/hooks/ai/useCredentials";
import { useT } from "@/hooks/i18n/useT";
import { CredentialCard } from "./CredentialCard";
import { AddCredentialDialog } from "./AddCredentialDialog";

interface Props {
  initialData: CredentialRow[];
  canWrite: boolean;
  usageMap: Record<string, number>;
}

// Rótulo e ordem saem da lista única — provedor novo aparece na tela sem que
// alguém precise lembrar de acrescentá-lo em três lugares.
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  PROVEDORES.map((p) => [p.id, p.rotulo]),
);

const PROVIDER_ORDER: Provider[] = PROVEDORES.map((p) => p.id);

export function CredentialsList({ initialData, canWrite, usageMap }: Props) {
  const t = useT();
  const { data } = useCredentialsList({ initialData });
  const [addOpen, setAddOpen] = useState(false);

  const credentials = data ?? [];

  // Construído a partir da lista única: escrito à mão, o dia em que um
  // provedor novo entra é o dia em que as credenciais dele somem da tela sem
  // ninguém ver (aconteceu com a OpenRouter).
  const grouped: Partial<Record<Provider, CredentialRow[]>> = Object.fromEntries(
    PROVEDORES.map((p) => [p.id, [] as CredentialRow[]]),
  );
  for (const c of credentials) {
    grouped[c.provider]?.push(c);
  }

  if (credentials.length === 0) {
    return (
      <>
        <div className="ios-grupo flex flex-col items-center gap-3 p-10 text-center">
          <h2 className="font-medium">{t("Nenhuma chave cadastrada ainda")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Seus agentes só conseguem pensar depois que você cola aqui uma chave da Anthropic, da OpenAI ou do Google. A cobrança vai direto para a sua conta no provedor, e a chave fica guardada criptografada.",
            )}
          </p>
          {canWrite && (
            <Button className="mt-1" onClick={() => setAddOpen(true)}>
              <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar credencial")}
            </Button>
          )}
        </div>
        <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
      </>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex sm:justify-end">
        {canWrite && (
          <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
            <Plus size={14} aria-hidden className="mr-2" /> {t("Adicionar credencial")}
          </Button>
        )}
      </div>
      {PROVIDER_ORDER.map((p) => {
        // `?? []` porque a lista de provedores pode crescer sem que exista
        // credencial daquele provedor — o agrupamento só tem chave para quem
        // tem linha.
        const rows = grouped[p] ?? [];
        if (rows.length === 0) return null;
        return (
          <Grupo key={p} titulo={PROVIDER_LABELS[p]} testid={`credenciais-${p}`}>
            {rows.map((row) => (
              <CredentialCard
                key={row.id}
                credential={row}
                canWrite={canWrite}
                usageCount={usageMap[row.id] ?? 0}
              />
            ))}
          </Grupo>
        );
      })}

      <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
