/**
 * O ramo do negócio, para o construtor escolher as regras setoriais.
 *
 * Reaproveita o vocabulário que o onboarding já usa para sugerir funil
 * (`escolherPacotePorTexto`): dois detectores de ramo divergiriam, e a clínica
 * receberia funil de clínica e agente de loja.
 */
import { escolherPacotePorTexto } from "@/lib/onboarding/sugerir-funil";

export const NICHOS = ["clinica", "imobiliaria", "servicos", "curso", "loja", "generico"] as const;

export type Nicho = (typeof NICHOS)[number];

export function eNicho(v: unknown): v is Nicho {
  return typeof v === "string" && (NICHOS as readonly string[]).includes(v);
}

export function nichoDoTexto(texto: string): Nicho {
  const id = escolherPacotePorTexto(texto).id;
  return eNicho(id) ? id : "generico";
}
