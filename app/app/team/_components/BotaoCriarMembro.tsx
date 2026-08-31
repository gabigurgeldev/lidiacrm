"use client";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

import { CriarMembroDialog } from "./CriarMembroDialog";

/**
 * O botão vive num componente client só porque o diálogo precisa de estado — a
 * página de equipe é Server Component e não pode segurá-lo.
 */
export function BotaoCriarMembro() {
  const t = useT();
  const [aberto, setAberto] = React.useState(false);

  return (
    <>
      <Button className="shrink-0" onClick={() => setAberto(true)} data-testid="abrir-criar-membro">
        {t("Criar usuário")}
      </Button>
      <CriarMembroDialog open={aberto} onOpenChange={setAberto} />
    </>
  );
}
