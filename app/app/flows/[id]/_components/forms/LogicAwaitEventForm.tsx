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
import { EVENTOS_QUE_ACORDAM } from "@/lib/flow-engine/nodes/paralelo";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * O nome humano de cada evento que o bloco de espera oferece.
 *
 * Só os RÓTULOS moram aqui; a lista de valores vem do registry. É a divisão que
 * `nodeVisuals.ts` já usa: o backend decide o que existe, o cliente decide como
 * chamar — e um evento novo aparece na tela mesmo que alguém esqueça deste mapa
 * (cai no próprio identificador, feio mas funcional).
 */
const ROTULO_DO_EVENTO: Record<string, string> = {
  "message.received": "O cliente responder",
  "lead.stage_changed": "O lead mudar de etapa",
  "lead.won": "O lead ser ganho",
  "lead.lost": "O lead ser perdido",
};

/** `logic.await_event` — dorme até um evento acontecer, ou o prazo vencer. */
export function LogicAwaitEventForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const horas = Math.round(Number(config.prazo_ms ?? 3_600_000) / 3_600_000);

  return (
    <Secao>
      <Campo rotulo={t("Esperar o quê?")}>
        <Select
          value={String(config.evento ?? "message.received")}
          onValueChange={(v) => mudar({ evento: v })}
        >
          <SelectTrigger data-testid="campo-evento-esperado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/*
              As opções saem de `EVENTOS_QUE_ACORDAM`, a mesma lista que o
              handler do barramento escuta. Repetir os valores aqui à mão
              criaria a divergência mais silenciosa possível: a pessoa
              escolheria a opção, o fluxo dormiria, o evento aconteceria — e
              ninguém acordaria, porque o handler nunca soube dele.
            */}
            {EVENTOS_QUE_ACORDAM.map((evento) => (
              <SelectItem key={evento} value={evento}>
                {t(ROTULO_DO_EVENTO[evento] ?? evento)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          data-testid="campo-prazo-do-evento"
        />
        <Dica
          texto={t(
            "Vencido o prazo, o fluxo segue pela saída 'Venceu o prazo'. Toda espera precisa de prazo — sem ele o fluxo ficaria parado para sempre.",
          )}
        />
      </Campo>
    </Secao>
  );
}
