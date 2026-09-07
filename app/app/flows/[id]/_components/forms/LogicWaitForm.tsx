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
 * `logic.wait` — espera de relógio, com UNIDADE.
 *
 * Era um campo só de minutos, com mínimo 5, porque o motor rodava 1×/min e
 * abaixo disso o número era ficção. `lib/flow-engine/loop.ts` derrubou esse
 * relógio (retomada de ~2s), o piso do schema caiu para 10s, e o campo passou a
 * poder oferecer segundos.
 *
 * A unidade não é enfeite: era preciso digitar `4320` para esperar três dias, e
 * ninguém confere esse número — erra-se por um zero e o fluxo dorme um mês.
 */

/** Segundos é a menor unidade porque o piso do schema é 10s. */
const UNIDADES = [
  { id: "segundos", rotulo: "segundos", ms: 1_000 },
  { id: "minutos", rotulo: "minutos", ms: 60_000 },
  { id: "horas", rotulo: "horas", ms: 3_600_000 },
  { id: "dias", rotulo: "dias", ms: 86_400_000 },
] as const;

type UnidadeId = (typeof UNIDADES)[number]["id"];

const MINIMO_MS = 10_000;
const MAXIMO_MS = 90 * 86_400_000;

/**
 * A maior unidade que representa esta duração SEM sobra — é o que faz "3 dias"
 * reabrir como "3 dias" em vez de "4320 minutos".
 */
export function melhorUnidade(ms: number): UnidadeId {
  for (const u of [...UNIDADES].reverse()) {
    if (ms >= u.ms && ms % u.ms === 0) return u.id;
  }
  return "segundos";
}

export function LogicWaitForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const ms = Number(config.duracao_ms ?? 300_000);
  const unidade = melhorUnidade(ms);
  const fator = UNIDADES.find((u) => u.id === unidade)?.ms ?? 1_000;
  const quantidade = Math.max(1, Math.round(ms / fator));

  /** Grava sempre em ms, preso à faixa que o schema aceita. */
  const gravar = (qtd: number, emMs: number) => {
    const bruto = Math.max(1, Math.round(qtd)) * emMs;
    aoMudarConfig({
      ...config,
      duracao_ms: Math.min(MAXIMO_MS, Math.max(MINIMO_MS, bruto)),
    });
  };

  return (
    <Secao>
      <Campo rotulo={t("Esperar quanto tempo?")}>
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => gravar(Number(e.target.value), fator)}
            data-testid="campo-espera-quantidade"
            className="flex-1"
          />
          <Select
            value={unidade}
            onValueChange={(v) => {
              // Troca de unidade CONVERTE o valor digitado, em vez de reinterpretar
              // o número cru: mudar de "5 minutos" para horas vira 5 horas, que é o
              // que a pessoa quis dizer — não 5 ms virando 5 horas por acidente.
              const novo = UNIDADES.find((u) => u.id === v)?.ms ?? 1_000;
              gravar(quantidade, novo);
            }}
          >
            <SelectTrigger className="w-32" data-testid="campo-espera-unidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {t(u.rotulo)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dica
          texto={t(
            "Mínimo de 10 segundos. O fluxo retoma em cerca de 2 segundos depois do prazo — o tempo que você marca é respeitado.",
          )}
        />
      </Campo>
    </Secao>
  );
}
