"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { PuzzlePiece, UploadSimple, DownloadSimple, Trash } from "@/lib/ui/icons";
import { usePermission } from "@/hooks/auth/AuthProvider";
import {
  useSkills,
  useInstallSkill,
  useUninstallSkill,
  useImportSkill,
  type SkillsState,
} from "@/hooks/ai/useSkills";
import { useT } from "@/hooks/i18n/useT";
import { Grupo, Linha } from "@/components/ajustes";

interface Props {
  initialState: SkillsState;
}

function formatDate(iso: string, idioma: string): string {
  return new Date(iso).toLocaleString(idioma, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SkillsClient({ initialState }: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const { data } = useSkills(initialState);
  const installed = data?.installed ?? [];
  const catalog = data?.catalog ?? [];
  const canManage = usePermission("ai.skills.manage");

  const install = useInstallSkill();
  const uninstall = useUninstallSkill();
  const importSkill = useImportSkill();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingName, setPendingName] = React.useState<string | null>(null);

  function handleInstall(name: string) {
    setPendingName(name);
    install.mutate(name, {
      onSuccess: () => {
        toast.success(`Skill "${name}" ${t("instalada — já vale para os agentes desta organização.")}`);
        setPendingName(null);
      },
      onError: (err) => {
        showApiError(err);
        setPendingName(null);
      },
    });
  }

  function handleUninstall(name: string) {
    setPendingName(name);
    uninstall.mutate(name, {
      onSuccess: () => {
        toast.success(`Skill "${name}" ${t("desinstalada.")}`);
        setPendingName(null);
      },
      onError: (err) => {
        showApiError(err);
        setPendingName(null);
      },
    });
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    importSkill.mutate(file, {
      onSuccess: (res) => {
        toast.success(`Skill "${res.data.name}" ${t("enviada e instalada com sucesso.")}`);
      },
      onError: showApiError,
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {canManage && (
        <div className="flex sm:justify-end">
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileChosen} />
          <Button
            variant="secondary"
            size="sm"
            disabled={importSkill.isPending}
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-auto"
          >
            <UploadSimple /> {importSkill.isPending ? t("Enviando…") : t("Enviar skill (.zip)")}
          </Button>
        </div>
      )}

      <Grupo
        titulo={t("Skills instaladas")}
        rodape={t(
          "Para personalizar uma skill instalada, basta reenviar um .zip com o mesmo nome — a sua versão passa a valer no lugar da do catálogo. Não há editor dentro do sistema nesta fase.",
        )}
        recuo="icone"
        testid="skills-instaladas"
      >
        {installed.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t('Nenhuma skill instalada ainda. Instale uma pronta do catálogo abaixo ou envie a sua em "Enviar skill (.zip)".')}
          </p>
        ) : (
          installed.map((skill) => (
            <Linha
              key={skill.name}
              icone={<PuzzlePiece size={18} />}
              disco
              titulo={skill.name}
              descricao={
                <>
                  {skill.description ? <span className="block">{skill.description}</span> : null}
                  {skill.source === "catalog" ? t("do catálogo") : t("manual")} · {t("atualizada em")}{" "}
                  {formatDate(skill.updated_at, tagDoIdioma)}
                </>
              }
              controle={
                canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={uninstall.isPending && pendingName === skill.name}
                    onClick={() => handleUninstall(skill.name)}
                  >
                    <Trash /> {t("Desinstalar")}
                  </Button>
                ) : undefined
              }
            />
          ))
        )}
      </Grupo>

      <Grupo
        titulo={t("Catálogo")}
        rodape={t("Skills prontas, mantidas pela plataforma, disponíveis para instalar com um clique.")}
        recuo="icone"
        testid="skills-catalogo"
      >
        {catalog.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t("Nenhuma skill nova no catálogo — você já instalou tudo que a plataforma oferece hoje.")}
          </p>
        ) : (
          catalog.map((skill) => (
            <Linha
              key={skill.name}
              icone={<PuzzlePiece size={18} />}
              disco
              titulo={skill.name}
              descricao={skill.description ?? undefined}
              controle={
                canManage ? (
                  <Button
                    size="sm"
                    disabled={install.isPending && pendingName === skill.name}
                    onClick={() => handleInstall(skill.name)}
                  >
                    <DownloadSimple />
                    {install.isPending && pendingName === skill.name ? t("Instalando…") : t("Instalar")}
                  </Button>
                ) : undefined
              }
            />
          ))
        )}
      </Grupo>
    </div>
  );
}
