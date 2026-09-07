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

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * O corpo compartilhado por `routing.round_robin` e `routing.redistribute`.
 *
 * Os dois blocos escolhem gente pela MESMA regra de indisponibilidade, e por
 * isso os ajustes são os mesmos. Mora num arquivo próprio, e não dentro de um
 * dos dois formulários, porque "o formulário do rodízio importando do
 * formulário da redistribuição" seria uma hierarquia inventada entre irmãos —
 * no dia em que um dos dois ganhar um campo, quem lê não sabe de quem é a casa.
 *
 * Os arquivos dos dois blocos continuam existindo separados de propósito: é
 * onde a divergência vai caber quando ela vier, sem uma nova cirurgia.
 */
export function CorpoDoRodizio({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  return (
    <Secao>
      <Campo rotulo={t("Se não houver ninguém disponível")}>
        <Select
          value={String(config.quando_ninguem ?? "tentar_depois")}
          onValueChange={(v) => mudar({ quando_ninguem: v })}
        >
          <SelectTrigger data-testid="campo-quando-ninguem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tentar_depois">{t("Esperar e tentar de novo")}</SelectItem>
            <SelectItem value="seguir_pelo_senao">
              {t("Seguir pela saída 'Ninguém disponível'")}
            </SelectItem>
          </SelectContent>
        </Select>
        <Dica
          texto={t(
            "Fora do horário comercial não há ninguém disponível, e isso não é erro — por isso o padrão é esperar.",
          )}
        />
      </Campo>
      <Campo rotulo={t("Tentar de novo depois de quantos minutos?")}>
        <Input
          type="number"
          min={1}
          max={1440}
          value={Math.round(Number(config.tentar_de_novo_em_ms ?? 300_000) / 60_000)}
          onChange={(e) =>
            mudar({ tentar_de_novo_em_ms: Math.max(1, Number(e.target.value)) * 60_000 })
          }
          data-testid="campo-tentar-de-novo"
        />
      </Campo>
    </Secao>
  );
}
