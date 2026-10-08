"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { SeletorDeCanal } from "./SeletorDeCanal";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `logic.ask` — perguntar e guardar a resposta inteira numa variável.
 *
 * O nome da variável é o que liga esta pergunta ao resto do fluxo: a mensagem
 * de entrega à IA e o bloco de atualizar o nome leem `{{vars.<nome>}}`.
 */
export function LogicAskForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const horas = Math.round(Number(config.prazo_ms ?? 3_600_000) / 3_600_000);
  const variavel = String(config.variavel ?? "resposta");

  return (
    <div className="flex flex-col gap-4">
      <Secao>
        <Campo rotulo={t("Pergunta")}>
          <CampoComVariavel
            multilinha
            linhas={4}
            maxLength={1000}
            valor={String(config.pergunta ?? "")}
            aoMudar={(v) => mudar({ pergunta: v })}
            testid="campo-pergunta"
          />
          <Dica texto={t("Deixe vazio se a pergunta já saiu num bloco de mensagem antes deste.")} />
        </Campo>
        <Campo rotulo={t("Guardar a resposta em")}>
          <Input
            value={variavel}
            maxLength={40}
            onChange={(e) => mudar({ variavel: e.target.value.toLowerCase().replace(/[^a-z0-9_]/gu, "_") })}
            data-testid="campo-variavel"
          />
          <Dica texto={t("Use depois como {{vars.") + variavel + "}}."} />
        </Campo>
        <Campo rotulo={t("Esperar por quantas horas?")}>
          <Input
            type="number"
            min={1}
            max={720}
            value={horas}
            onChange={(e) =>
              mudar({ prazo_ms: Math.min(720, Math.max(1, Number(e.target.value))) * 3_600_000 })
            }
            data-testid="campo-prazo-da-pergunta"
          />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por onde enviar")}
        </p>
        <SeletorDeCanal
          valor={(config.canal_id as string | null) ?? null}
          aoEscolher={(id) => mudar({ canal_id: id })}
        />
      </div>
    </div>
  );
}
