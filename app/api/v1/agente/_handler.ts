/**
 * A pergunta à assistente de suporte, de ponta a ponta — sem Next, sem cookie.
 *
 * Tudo que tem efeito chega por `deps` (registro, modelo, ferramentas), para o
 * teste exercitar o limite diário e o laço de ferramentas sem banco nem rede.
 * Quem monta as dependências reais é `./route.ts`.
 *
 * ── A ordem, e por que é esta ───────────────────────────────────────────────
 *
 *  1. RESERVA a pergunta no contador do dia antes de qualquer custo
 *     (`fn_agente_reservar_pergunta`, atômica: duas requisições juntas não
 *     passam do teto). No limite, 429 — sem gravar nada e sem chamar o modelo.
 *  2. A pergunta é mascarada (telefone, CPF, e-mail) ANTES de ir ao banco e ao
 *     modelo: quem cola o número de um cliente na pergunta não o espalha.
 *  3. Laço de ferramentas no servidor: no máximo `RODADAS` chamadas ao modelo, e
 *     a última sai com `tool_choice: "none"` para forçar a resposta em texto.
 *     Teto de ferramentas por rodada e por pergunta, repetição idêntica
 *     reaproveitada, e o prazo `TEMPO_MAXIMO_MS` alcança TAMBÉM as consultas
 *     (o sinal vai ao `.abortSignal()` de cada uma), não só a chamada ao modelo.
 *  4. Grava a resposta com tokens, custo e os NOMES das ferramentas usadas. Se
 *     o modelo falhar, grava uma resposta de falha antes de propagar o erro —
 *     a conversa nunca fica com pergunta sem resposta.
 */
import { z } from "zod";

import type { EscopoDoAgente } from "@/agente/escopo";
import { definicoesParaOModelo } from "@/agente/ferramentas";
import type { ChamarModelo, MensagemDoModelo } from "@/agente/openrouter.server";
import { mascararTextoLivre } from "@/agente/mascara";
import { mensagemDeSistema, type Contexto, type Identidade } from "@/agente/prompt";
import type { RegistroDoAgente } from "@/agente/registro.server";
import "@/agente/so-no-servidor";
import { FUSO_PADRAO } from "@/agente/tempo";

export const TAMANHO_MAXIMO_DA_PERGUNTA = 2000;
export const MENSAGENS_DE_HISTORICO = 12;
export const RODADAS = 4;
export const TEMPO_MAXIMO_MS = 25_000;
export const MAX_TOKENS = 1000;
/** Ferramentas por resposta do modelo, e por pergunta inteira. O excedente recebe erro, não roda. */
export const FERRAMENTAS_POR_RODADA = 4;
export const FERRAMENTAS_POR_PERGUNTA = 6;

export const corpoDaPergunta = z.object({
  mensagem: z
    .string()
    .trim()
    .min(1, "Escreva uma pergunta.")
    .max(TAMANHO_MAXIMO_DA_PERGUNTA, {
      message: `A pergunta pode ter até ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`,
    }),
  conversa_id: z.string().uuid().optional().nullable(),
});
export type CorpoDaPergunta = z.infer<typeof corpoDaPergunta>;

export interface DepsDaPergunta {
  registro: RegistroDoAgente;
  chamarModelo: ChamarModelo;
  executarFerramenta: (
    nome: string,
    argumentosJson: string,
    signal: AbortSignal,
  ) => Promise<string>;
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

/**
 * "Hoje" do limite diário: o dia de São Paulo (AAAA-MM-DD), igual para toda a
 * instalação — o contador é da pessoa, não da organização.
 */
export function diaDoLimite(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_PADRAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

const RESPOSTA_DE_TEMPO_ESGOTADO =
  "Desculpe, demorei mais do que devia para consultar isso. Pode tentar de novo, talvez com uma pergunta mais específica?";
const RESPOSTA_VAZIA = "Não consegui formular uma resposta agora. Pode reformular a pergunta?";
const RESPOSTA_DE_FALHA =
  "Não consegui responder agora — o serviço da assistente falhou. Tente de novo em alguns minutos.";
const ERRO_DE_LIMITE_DE_FERRAMENTAS = JSON.stringify({ erro: "limite de ferramentas" });

class TempoEsgotado extends Error {}

export async function responderPergunta(
  escopo: EscopoDoAgente,
  corpo: CorpoDaPergunta,
  deps: DepsDaPergunta,
): Promise<ResultadoDaPergunta> {
  const { registro } = deps;
  const limite = deps.limiteDiario;

  const usadas = await registro.reservarPergunta(escopo.userId, diaDoLimite(deps.agora), limite);
  if (usadas === null) {
    return { tipo: "limite_atingido", usadas_hoje: limite, limite };
  }

  // A conversa do corpo só vale se for desta pessoa nesta organização.
  const conversaId =
    (corpo.conversa_id
      ? await registro.conversaValida(escopo.userId, escopo.organizationId, corpo.conversa_id)
      : null) ?? (await registro.abrirConversa(escopo.userId, escopo.organizationId));

  // O histórico vem do BANCO, nunca do corpo: um "assistant" forjado no corpo
  // seria a forma mais barata de pôr palavras na boca da assistente.
  const historico = await registro.historico(escopo.userId, conversaId, MENSAGENS_DE_HISTORICO);
  const pergunta = mascararTextoLivre(corpo.mensagem);
  await registro.gravarPergunta(escopo.userId, escopo.organizationId, conversaId, pergunta);

  const mensagens: MensagemDoModelo[] = [
    { role: "system", content: mensagemDeSistema(deps.identidade, deps.contexto) },
    ...historico.map((m) => ({ role: m.role, content: m.content }) as MensagemDoModelo),
    { role: "user", content: pergunta },
  ];

  const ferramentasUsadas: string[] = [];
  const jaExecutadas = new Map<string, string>();
  let tokensIn = 0;
  let tokensOut = 0;
  let custoUsd: number | null = null;
  let resposta: string | null = null;

  const controle = new AbortController();
  const relogio = setTimeout(
    () => controle.abort(new TempoEsgotado("tempo esgotado")),
    deps.tempoMaximoMs ?? TEMPO_MAXIMO_MS,
  );
  const tools = definicoesParaOModelo();
  const consumo = () => ({
    tokensIn,
    tokensOut,
    custoUsd,
    modelo: deps.modelo,
    ferramentas: ferramentasUsadas,
  });

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
      // Todo `tool_call` pedido recebe UMA resposta `tool` (o modelo exige o
      // par); o que passa do teto recebe erro em vez de rodar, e a repetição
      // idêntica (mesmo nome, mesmos argumentos) reaproveita o resultado.
      for (const [i, chamada] of r.chamadas.entries()) {
        if (controle.signal.aborted) throw new TempoEsgotado("tempo esgotado");
        const nome = chamada.function.name;
        const args = chamada.function.arguments ?? "";
        const chave = JSON.stringify([nome, args]);
        let conteudo = jaExecutadas.get(chave);
        if (conteudo === undefined) {
          if (i >= FERRAMENTAS_POR_RODADA || ferramentasUsadas.length >= FERRAMENTAS_POR_PERGUNTA) {
            conteudo = ERRO_DE_LIMITE_DE_FERRAMENTAS;
          } else {
            ferramentasUsadas.push(nome);
            conteudo = await deps.executarFerramenta(nome, args, controle.signal);
            jaExecutadas.set(chave, conteudo);
          }
        }
        mensagens.push({ role: "tool", tool_call_id: chamada.id, content: conteudo });
      }
    }
  } catch (e) {
    if (!controle.signal.aborted && !(e instanceof TempoEsgotado)) {
      // Falha do modelo (ou do banco): a pergunta já está gravada, e a conversa
      // não pode ficar com ela sem resposta. Grava a falha e propaga.
      await registro
        .gravarResposta(
          escopo.userId,
          escopo.organizationId,
          conversaId,
          RESPOSTA_DE_FALHA,
          consumo(),
        )
        .catch(() => {});
      throw e;
    }
    resposta = RESPOSTA_DE_TEMPO_ESGOTADO;
  } finally {
    clearTimeout(relogio);
  }

  const texto = resposta?.trim() || RESPOSTA_VAZIA;
  await registro.gravarResposta(escopo.userId, escopo.organizationId, conversaId, texto, consumo());

  return {
    tipo: "respondida",
    conversa_id: conversaId,
    resposta: texto,
    usadas_hoje: usadas,
    limite,
    ferramentas: ferramentasUsadas,
    tokensIn,
    tokensOut,
    custoUsd,
  };
}
