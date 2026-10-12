/**
 * A PROVA DE SALVAR: o modelo escolhido entrega 1536 dimensões com esta chave?
 *
 * Toda troca de modelo do material passa por uma chamada de verdade antes de
 * gravar. Ela custa uma fração de centavo e responde, de uma vez, três
 * perguntas que a tela não consegue responder sozinha:
 *
 *  - a chave funciona para esse provedor?
 *  - esse provedor serve esse modelo? (a OpenRouter, por exemplo, pode não
 *    repassar o parâmetro de corte de um modelo específico);
 *  - o vetor sai com 1536 dimensões, que é o que `ai_chunks` aceita?
 *
 * Sem a prova, um erro em qualquer uma delas só apareceria depois — como
 * material que nunca fica pronto, todo ele, ao mesmo tempo.
 */
import { embedText } from "@/lib/ai/embed";

import type { ModeloDeEmbedding } from "./catalogo";
import { chaveParaProva } from "./chave";

export type ResultadoDaProva =
  | { ok: true }
  | {
      ok: false;
      codigo: "embedding_sem_chave" | "embedding_dimensao_incompativel" | "embedding_chave_recusada" | "embedding_provedor_indisponivel";
      mensagem: string;
      status: 422 | 502;
    };

const NOME = { openai: "OpenAI", openrouter: "OpenRouter", google: "Google" } as const;

/** Traduz o erro da chamada para o que a pessoa precisa fazer. Puro. */
export function motivoDaFalha(err: unknown, modelo: ModeloDeEmbedding): Exclude<ResultadoDaProva, { ok: true }> {
  const texto = err instanceof Error ? err.message : String(err);
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode ?? (err as { status?: number } | null)?.status;
  if (/dimens/i.test(texto)) {
    return {
      ok: false,
      codigo: "embedding_dimensao_incompativel",
      mensagem: `"${modelo.idNoProvedor}" pela ${NOME[modelo.provedor]} não entregou vetores de 1536 dimensões, que é o tamanho que o seu material usa. Escolha outro modelo ou outro provedor.`,
      status: 422,
    };
  }
  if (status === 401 || status === 403 || /unauthori|invalid api key|incorrect api key|forbidden/i.test(texto)) {
    return {
      ok: false,
      codigo: "embedding_chave_recusada",
      mensagem: `A ${NOME[modelo.provedor]} recusou a chave. Confira a chave em Credenciais ou escolha outra.`,
      status: 422,
    };
  }
  if (status === 404 || /not found|does not exist|no endpoints|model_not_found/i.test(texto)) {
    return {
      ok: false,
      codigo: "embedding_dimensao_incompativel",
      mensagem: `A ${NOME[modelo.provedor]} não encontrou o modelo "${modelo.idNoProvedor}". Confira o nome.`,
      status: 422,
    };
  }
  return {
    ok: false,
    codigo: "embedding_provedor_indisponivel",
    mensagem: `Não consegui falar com a ${NOME[modelo.provedor]} agora. Nada foi trocado; tente de novo em instantes.`,
    status: 502,
  };
}

export async function provarModeloDeEmbedding(
  organizationId: string,
  modelo: ModeloDeEmbedding,
  credentialId: string | null,
  deps?: { embed?: typeof embedText; chave?: typeof chaveParaProva },
): Promise<ResultadoDaProva> {
  const chave = await (deps?.chave ?? chaveParaProva)(organizationId, modelo, credentialId);
  if (!chave) {
    return {
      ok: false,
      codigo: "embedding_sem_chave",
      mensagem: `Não há chave da ${NOME[modelo.provedor]} cadastrada em Credenciais${
        modelo.provedor === "google" ? "" : " nem na instalação"
      }. Cadastre uma antes de trocar.`,
      status: 422,
    };
  }
  try {
    await (deps?.embed ?? embedText)("teste de dimensão do modelo de embedding", {
      organizationId,
      ponto: "embedding_consultar",
      chave,
    });
    return { ok: true };
  } catch (err) {
    return motivoDaFalha(err, modelo);
  }
}
