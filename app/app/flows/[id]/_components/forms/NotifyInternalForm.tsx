"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Secao, type PropsDoFormulario } from "./shared";

/** `notify.internal` — abre um aviso na Central. */
export function NotifyInternalForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  return (
    <Secao>
      <Campo rotulo={t("Título do aviso")}>
        <Input
          value={String(config.titulo ?? "")}
          maxLength={120}
          onChange={(e) => mudar({ titulo: e.target.value })}
          data-testid="campo-titulo-do-aviso"
        />
      </Campo>
      <Campo rotulo={t("Texto do aviso")}>
        <Textarea
          rows={4}
          maxLength={1000}
          value={String(config.corpo ?? "")}
          onChange={(e) => mudar({ corpo: e.target.value })}
          data-testid="campo-corpo-do-aviso"
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
