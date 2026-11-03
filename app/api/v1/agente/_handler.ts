/**
 * A pergunta à assistente de suporte, de ponta a ponta — sem Next, sem cookie.
 *
 * Tudo que tem efeito chega por `deps` (registro, modelo, ferramentas), para o
 * teste exercitar o limite diário e o laço de ferramentas sem banco nem rede.
 * Quem monta as dependências reais é `./route.ts`.
 *
 * ── A ordem, e por que é esta ───────────────────────────────────────────────
 *
 *  1. Conta as perguntas de hoje ANTES de qualquer custo. No limite, 429 — sem
 *     gravar nada e sem chamar o modelo.
 *  2. Grava a pergunta antes de chamar o modelo: duas abas mandando ao mesmo
 *     tempo passam a enxergar uma a outra na contagem.
 *  3. Laço de ferramentas no servidor: no máximo `RODADAS` chamadas ao modelo, e
 *     a última sai com `tool_choice: "none"` para forçar a resposta em texto.
 *     O conjunto inteiro corre contra `TEMPO_MAXIMO_MS`.
 *  4. Grava a resposta com tokens, custo e os NOMES das ferramentas usadas.
 */
import { z } from "zod";

import type { EscopoDoAgente } from "@/agente/escopo";
import { definicoesParaOModelo } from "@/agente/ferramentas";
import type { ChamarModelo, MensagemDoModelo } from "@/agente/openrouter.server";
import { mensagemDeSistema, type Contexto, type Identidade } from "@/agente/prompt";
import type { RegistroDoAgente } from "@/agente/registro.server";
import { FUSO_PADRAO, inicioDoDia } from "@/agente/tempo";

export const TAMANHO_MAXIMO_DA_PERGUNTA = 2000;
export const MENSAGENS_DE_HISTORICO = 12;
export const RODADAS = 4;
export const TEMPO_MAXIMO_MS = 25_000;
export const MAX_TOKENS = 1000;

export const corpoDaPergunta = z.object({
  mensagem: z.string().trim().min(1, "Escreva uma pergunta.").max(TAMANHO_MAXIMO_DA_PERGUNTA, {
    message: `A pergunta pode ter até ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`,
  }),
  conversa_id: z.string().uuid().optional().nullable(),
});
export type CorpoDaPergunta = z.infer<typeof corpoDaPergunta>;

export interface DepsDaPergunta {
  registro: RegistroDoAgente;
  chamarModelo: ChamarModelo;
  executarFerramenta: (nome: string, argumentosJson: string) => Promise<string>;
  modelo: string;
  limiteDiario: number;
  identidade: Identidade;
  contexto: Contexto;
  agora: Date;
  tempoMaximoMs?: number;
}

export type ResultadoDaPergunta =
  | {
      tipo: "respondida";
      conversa_id: string;
      resposta: string;
      usadas_hoje: number;
      limite: number;
      ferramentas: string[];
      tokensIn: number;
      tokensOut: number;
      custoUsd: number | null;
    }
  | { tipo: "limite_atingido"; usadas_hoje: number; limite: number };

/** "Hoje" do limite diário: o dia de São Paulo, igual para toda a instalação. */
export function inicioDoDiaDoLimite(agora: Date): Date {
  return inicioDoDia(FUSO_PADRAO, agora);
}

const RESPOSTA_DE_TEMPO_ESGOTADO =
  "Desculpe, demorei mais do que devia para consultar isso. Pode tentar de novo, talvez com uma pergunta mais específica?";
const RESPOSTA_VAZIA = "Não consegui formular uma resposta agora. Pode reformular a pergunta?";

export async function responderPergunta(
  escopo: EscopoDoAgente,
  corpo: CorpoDaPergunta,
  deps: DepsDaPergunta,
): Promise<ResultadoDaPergunta> {
  const { registro } = deps;
  const desde = inicioDoDiaDoLimite(deps.agora);

  const jaUsadas = await registro.contarPerguntas(escopo.userId, desde);
  if (jaUsadas >= deps.limiteDiario) {
    return { tipo: "limite_atingido", usadas_hoje: jaUsadas, limite: deps.limiteDiario };
  }

  // A conversa do corpo só vale se for desta pessoa nesta organização.
  const conversaId =
    (corpo.conversa_id
      ? await registro.conversaValida(escopo.userId, escopo.organizationId, corpo.conversa_id)
      : null) ?? (await registro.abrirConversa(escopo.userId, escopo.organizationId));

  // O histórico vem do BANCO, nunca do corpo: um "assistant" forjado no corpo
  // seria a forma mais barata de pôr palavras na boca da assistente.
  const historico = await registro.historico(escopo.userId, conversaId, MENSAGENS_DE_HISTORICO);
  await registro.gravarPergunta(escopo.userId, escopo.organizationId, conversaId, corpo.mensagem);

  const mensagens: MensagemDoModelo[] = [
    { role: "system", content: mensagemDeSistema(deps.identidade, deps.contexto) },
    ...historico.map((m) => ({ role: m.role, content: m.content }) as MensagemDoModelo),
    { role: "user", content: corpo.mensagem },
  ];

  const ferramentasUsadas: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let custoUsd: number | null = null;
  let resposta: string | null = null;

  const controle = new AbortController();
  const relogio = setTimeout(
    () => controle.abort(new Error("tempo esgotado")),
    deps.tempoMaximoMs ?? TEMPO_MAXIMO_MS,
  );
  const tools = definicoesParaOModelo();

  try {
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const ultima = rodada === RODADAS - 1;
      const r = await deps.chamarModelo(
        {
          model: deps.modelo,
          messages: mensagens,
          tools,
          tool_choice: ultima ? "none" : "auto",
          max_tokens: MAX_TOKENS,
        },
        controle.signal,
      );
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      if (r.custoUsd !== null) custoUsd = (custoUsd ?? 0) + r.custoUsd;

      if (r.chamadas.length === 0 || ultima) {
        resposta = r.texto;
        break;
      }

      mensagens.push({ role: "assistant", content: r.texto, tool_calls: r.chamadas });
      for (const chamada of r.chamadas) {
        ferramentasUsadas.push(chamada.function.name);
        const conteudo = await deps.executarFerramenta(chamada.function.name, chamada.function.arguments ?? "");
        mensagens.push({ role: "tool", tool_call_id: chamada.id, content: conteudo });
      }
    }
  } catch (e) {
    if (!controle.signal.aborted) throw e;
    resposta = RESPOSTA_DE_TEMPO_ESGOTADO;
  } finally {
    clearTimeout(relogio);
  }

  const texto = resposta?.trim() || RESPOSTA_VAZIA;
  await registro.gravarResposta(escopo.userId, escopo.organizationId, conversaId, texto, {
    tokensIn,
    tokensOut,
    custoUsd,
    modelo: deps.modelo,
    ferramentas: ferramentasUsadas,
  });

  return {
    tipo: "respondida",
    conversa_id: conversaId,
    resposta: texto,
    usadas_hoje: jaUsadas + 1,
    limite: deps.limiteDiario,
    ferramentas: ferramentasUsadas,
    tokensIn,
    tokensOut,
    custoUsd,
  };
}
