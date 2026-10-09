/**
 * O RELATÓRIO DO ENSAIO, LIDO PARA QUEM CONFIGURA O AGENTE.
 *
 * O ensaio (`lib/agent-engine/ensaio/ensaiar.ts`) devolve o que o turno de
 * produção fez — em códigos de motor: `vetoed_gate`, `warmup_cap`, verdicts de
 * cada conferência. Aqui eles viram frases que o dono do negócio entende, sem
 * perder o que importa para ele decidir: o que sairia, o que foi barrado e por
 * quê, e o que ficaria pendente.
 *
 * Funções puras, sem React: a tela só desenha o que sai daqui, e o teste de
 * unidade cobre a tradução sem montar componente.
 */
import type { DesfechoDoEnsaio, FalaDoEnsaio, RelatorioDoEnsaio } from "@/lib/agent-engine/ensaio/ensaiar";
import { CONFERENCIAS_DE_SAIDA } from "@/lib/ai/guardrails/lista-de-conferencia";

export type { DesfechoDoEnsaio, FalaDoEnsaio, RelatorioDoEnsaio };

export type Tom = "ok" | "atencao" | "erro";

export interface DesfechoLegivel {
  titulo: string;
  detalhe: string | null;
  tom: Tom;
}

export type ResultadoDaConferencia = "passou" | "barrou" | "nao_se_aplica";

export interface LinhaDaConferencia {
  gate: string;
  rotulo: string;
  resultado: ResultadoDaConferencia;
  codigo: string | null;
}

export interface TentativaDeEnvio {
  numero: number;
  /** Rótulo da conferência que barrou esta tentativa; null = a mensagem passou. */
  barradaPor: string | null;
  linhas: LinhaDaConferencia[];
}

const ROTULO_POR_GATE = new Map(CONFERENCIAS_DE_SAIDA.map((c) => [c.nome, c.rotulo]));

/** O nome que a aba "Confere antes de enviar" dá à conferência — ou o código, se for nova. */
export function rotuloDaConferencia(gate: string): string {
  return ROTULO_POR_GATE.get(gate) ?? gate;
}

function lerLinha(entrada: unknown): LinhaDaConferencia | null {
  if (typeof entrada !== "object" || entrada === null) return null;
  const e = entrada as { gate?: unknown; verdict?: unknown; code?: unknown };
  if (typeof e.gate !== "string") return null;
  const resultado: ResultadoDaConferencia =
    e.verdict === "veto" ? "barrou" : e.verdict === "pass" ? "passou" : "nao_se_aplica";
  return {
    gate: e.gate,
    rotulo: rotuloDaConferencia(e.gate),
    resultado,
    codigo: typeof e.code === "string" ? e.code : null,
  };
}

/** Cada tentativa de envio, com o veredito de cada conferência. Trace ilegível vira lista vazia, nunca exceção. */
export function lerConferencias(conferencias: RelatorioDoEnsaio["conferencias"]): TentativaDeEnvio[] {
  return conferencias.map((c, i) => ({
    numero: i + 1,
    barradaPor: c.barradaPor === null ? null : rotuloDaConferencia(c.barradaPor),
    linhas: Array.isArray(c.trace) ? c.trace.map(lerLinha).filter((l): l is LinhaDaConferencia => l !== null) : [],
  }));
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** A manchete do teste: o que o cliente teria visto. */
export function lerDesfecho(r: RelatorioDoEnsaio): DesfechoLegivel {
  switch (r.desfecho) {
    case "respondeu":
      return {
        titulo: "O agente respondeu",
        detalhe: `${plural(r.mensagens.length, "mensagem", "mensagens")} — nada foi enviado ao WhatsApp.`,
        tom: "ok",
      };
    case "passou_para_humano":
      return {
        titulo: "O agente passou a conversa para uma pessoa",
        detalhe: "Em produção, a conversa iria para a fila da equipe e a IA ficaria calada nela.",
        tom: "atencao",
      };
    case "adiado":
      return {
        titulo: "O atendimento seria adiado",
        detalhe: r.adiamento?.motivo ?? null,
        tom: "atencao",
      };
    case "sem_resposta": {
      const barradas = r.conferencias.filter((c) => c.barradaPor !== null);
      return {
        titulo: "O cliente ficaria sem resposta",
        detalhe:
          barradas.length > 0
            ? `Toda mensagem que o agente tentou foi barrada: ${[
                ...new Set(barradas.map((c) => rotuloDaConferencia(c.barradaPor!))),
              ].join(", ")}.`
            : "O agente terminou sem chamar o envio, mesmo depois de cobrado.",
        tom: "erro",
      };
    }
    case "falhou":
      return { titulo: "O teste não conseguiu rodar", detalhe: r.erro, tom: "erro" };
  }
}

/** Custo em dólares, com casas suficientes para um teste barato não aparecer como zero. */
export function formatarCusto(custo: RelatorioDoEnsaio["custo"]): string {
  const dolares = custo.centavos / 100;
  const valor = dolares > 0 && dolares < 0.01 ? dolares.toFixed(4) : dolares.toFixed(2);
  return `US$ ${valor.replace(".", ",")}${custo.semPreco > 0 ? " (ou mais)" : ""}`;
}

/**
 * A conversa depois do teste: as mensagens do agente entram como falas, para o
 * próximo teste continuar dali — cada ensaio recria a conversa inteira.
 */
export function conversaDepois(conversa: FalaDoEnsaio[], r: RelatorioDoEnsaio): FalaDoEnsaio[] {
  return [...conversa, ...r.mensagens.map((m) => ({ de: "agente" as const, texto: m.texto }))];
}

/** O teto da rota (`/api/v1/ai/agents/:id/ensaio`): as falas mais antigas saem primeiro. */
export const MAX_FALAS_DO_ENSAIO = 40;

export function aparar(conversa: FalaDoEnsaio[]): FalaDoEnsaio[] {
  return conversa.length <= MAX_FALAS_DO_ENSAIO ? conversa : conversa.slice(-MAX_FALAS_DO_ENSAIO);
}
