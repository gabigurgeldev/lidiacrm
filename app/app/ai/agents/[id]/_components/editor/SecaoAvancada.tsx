"use client";
import { Campo, Grupo } from "@/components/ajustes";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { ConsumoPorAtendimento } from "../ConsumoPorAtendimento";
import type { FormState, PropsDaSecao } from "./estado";
import { ErroDoCampo } from "./pecas";

/**
 * Os ajustes que quase ninguém mexe: ordem entre agentes, freios por
 * atendimento e quanto da conversa ele relê. Os padrões servem para quem tem um
 * agente só — por isso ficam atrás de "Ajustes avançados", e não no caminho de
 * quem está criando o primeiro.
 */
export function SecaoAvancada({
  form,
  patch,
  disabled,
  erros,
  agentId,
}: PropsDaSecao & { agentId: string | null }) {
  const t = useT();

  const numero = (campo: keyof FormState, rotulo: string, limites: { min: number; max: number; step?: number }) => (
    <Campo rotulo={rotulo} htmlFor={campo}>
      <Input
        id={campo}
        type="number"
        min={limites.min}
        max={limites.max}
        step={limites.step ?? 1}
        value={form[campo] as number}
        onChange={(e) => patch({ [campo]: Number(e.target.value) } as Partial<FormState>)}
        disabled={disabled}
        aria-invalid={!!erros[campo]}
      />
      <ErroDoCampo texto={erros[campo]} />
    </Campo>
  );

  return (
    <>
      <Grupo
        titulo={t("Ordem entre agentes")}
        rodape={t(
          "Quando mais de um agente puder atender a mesma conversa, o de número maior tenta primeiro. Se você só tem um agente, pode deixar como está.",
        )}
      >
        {numero("priority", t("Ordem de preferência (0 a 1000)"), { min: 0, max: 1000 })}
      </Grupo>

      <Grupo
        titulo={t("Freios de segurança")}
        rodape={t(
          "Quando um atendimento alcança o volume ou o custo, o agente para de pensar e, se ainda não respondeu, é obrigado a responder ou passar para a equipe. A Central avisa.",
        )}
      >
        {numero("max_steps", t("Ações por atendimento (1 a 25)"), { min: 1, max: 25 })}
        {numero("token_budget", t("Volume de texto por atendimento"), { min: 1000, max: 500000, step: 1000 })}
        {/* Centavos de DÓLAR: é a unidade de `llm_calls.cost_cents`, que o motor compara. */}
        {numero("cost_budget_cents", t("Custo máximo por atendimento (centavos de dólar)"), { min: 1, max: 10000 })}
        {agentId ? (
          <div className="px-4 py-3">
            <ConsumoPorAtendimento
              agentId={agentId}
              limites={{ tokens: form.token_budget, centavos: form.cost_budget_cents }}
            />
          </div>
        ) : null}
      </Grupo>

      <Grupo titulo={t("Memória da conversa")}>
        {numero("history_message_window", t("Mensagens anteriores que ele lê"), { min: 0, max: 200 })}
        {numero("history_token_window", t("Tamanho máximo desse histórico"), { min: 0, max: 50000, step: 500 })}
      </Grupo>
    </>
  );
}
