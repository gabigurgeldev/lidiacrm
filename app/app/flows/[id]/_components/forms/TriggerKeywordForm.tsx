"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import { SeletorDeCanal } from "./SeletorDeCanal";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `trigger.keyword` — começa quando a mensagem traz uma das palavras. */
export function TriggerKeywordForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const palavras = Array.isArray(config.palavras) ? (config.palavras as string[]) : [];

  return (
    <Secao>
      <Campo rotulo={t("Palavras que começam o fluxo")}>
        <Input
          value={palavras.join(", ")}
          placeholder={t("orçamento, preço, quanto custa")}
          onChange={(e) =>
            mudar({
              palavras: e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter((x) => x !== ""),
            })
          }
          data-testid="campo-palavras-do-gatilho"
        />
        <Dica
          texto={t(
            "Separe por vírgula. Qualquer uma delas basta, e acento e maiúscula não fazem diferença.",
          )}
        />
      </Campo>

      <Campo rotulo={t("Como comparar")}>
        <Select
          value={String(config.modo ?? "contem")}
          onValueChange={(v) => mudar({ modo: v })}
        >
          <SelectTrigger data-testid="campo-modo-do-gatilho">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contem">{t("A palavra aparece na mensagem")}</SelectItem>
            <SelectItem value="exata">{t("A mensagem é exatamente a palavra")}</SelectItem>
          </SelectContent>
        </Select>
        <Dica
          texto={
            String(config.modo ?? "contem") === "exata"
              ? t("Serve para menu por número: com 'exata', a mensagem '10 reais' não escolhe a opção '1'.")
              : t("Pega a palavra no meio da frase. Cuidado com palavras curtas, que aparecem dentro de outras.")
          }
        />
      </Campo>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por quais números o fluxo escuta")}
        </p>
        <SeletorDeCanal
          proposito="escuta"
          valor={(config.canal_id as string | null) ?? null}
          aoEscolher={(id) => mudar({ canal_id: id })}
        />
      </div>
    </Secao>
  );
}
