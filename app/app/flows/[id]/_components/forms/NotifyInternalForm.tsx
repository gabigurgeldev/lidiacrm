"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { Campo, Secao, type PropsDoFormulario } from "./shared";

/** `notify.internal` — abre um aviso na Central. */
export function NotifyInternalForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  return (
    <Secao>
      <Campo rotulo={t("Título do aviso")}>
        <CampoComVariavel
          valor={String(config.titulo ?? "")}
          maxLength={120}
          aoMudar={(v) => mudar({ titulo: v })}
          testid="campo-titulo-do-aviso"
        />
      </Campo>
      <Campo rotulo={t("Texto do aviso")}>
        <CampoComVariavel
          multilinha
          linhas={4}
          maxLength={1000}
          valor={String(config.corpo ?? "")}
          aoMudar={(v) => mudar({ corpo: v })}
          testid="campo-corpo-do-aviso"
        />
      </Campo>
      <Campo rotulo={t("Gravidade")}>
        <Select
          value={String(config.severidade ?? "warn")}
          onValueChange={(v) => mudar({ severidade: v })}
        >
          <SelectTrigger data-testid="campo-gravidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="info">{t("Informação")}</SelectItem>
            <SelectItem value="warn">{t("Atenção")}</SelectItem>
            <SelectItem value="critical">{t("Urgente")}</SelectItem>
          </SelectContent>
        </Select>
      </Campo>
    </Secao>
  );
}
