/**
 * Corrigir um agente que já existe com a IA — os contratos.
 *
 * Três passos, três rotas em `app/api/v1/ai/agents/[id]/correcao/`:
 *
 *   1. diagnosticar — a pessoa relata o problema (e, se quiser, aponta a
 *      conversa em que ele aconteceu). A IA lê o agente, as últimas execuções e
 *      a conversa e devolve as causas prováveis, com evidência, e até 3
 *      perguntas quando precisa de uma decisão do dono;
 *   2. propor — com o diagnóstico e as respostas, a IA devolve o prompt novo
 *      INTEIRO e as mudanças em materiais, capacidades e frases de passagem,
 *      cada uma com o porquê. A tela mostra antes × depois e deixa desmarcar;
 *   3. aplicar — o que ficou marcado vira RASCUNHO do agente. Nunca publica:
 *      quem coloca no ar é a pessoa, no editor, depois de testar.
 *
 * Nenhum passo antes do 3 escreve no banco.
 */
import { z } from "zod";

import { anexosSchema, IDS_DE_PACOTE, TETO_DE_ITENS_POR_FAQ } from "@/lib/ai/agents/construtor/esquemas";

export const MAX_PERGUNTAS_DA_CORRECAO = 3;
export const MAX_EXECUCOES_LIDAS = 20;
export const MAX_MENSAGENS_DA_CONVERSA = 40;
export const TETO_DE_MATERIAIS_NOVOS = 4;

const historicoSchema = z
  .array(z.strictObject({ papel: z.enum(["usuario", "ia"]), texto: z.string().max(4000) }))
  .max(40)
  .default([]);

const problemaSchema = z.string().trim().min(10, "Conte o problema com um pouco mais de detalhe.").max(4000);

export const entradaDoDiagnosticoSchema = z.strictObject({
  problema: problemaSchema,
  /** A conversa em que o problema aconteceu. Conferida contra a organização da sessão. */
  conversation_id: z.string().uuid().optional(),
  anexos: anexosSchema,
  /** Perguntas do diagnóstico e respostas do dono, quando houve rodada. */
  historico: historicoSchema,
});

export const ONDE_ESTA_A_CAUSA = [
  "prompt",
  "materiais",
  "capacidades",
  "frases_de_passagem",
  "configuracao",
  "fora_do_agente",
] as const;
export type OndeEstaACausa = (typeof ONDE_ESTA_A_CAUSA)[number];

export const saidaDoDiagnosticoSchema = z.object({
  resumo: z.string().describe("Em 1 a 2 frases, o que está acontecendo e por quê, para o dono ler."),
  hipoteses: z
    .array(
      z.object({
        causa: z.string().describe("A causa provável, numa frase concreta."),
        evidencia: z
          .string()
          .describe("O trecho literal do prompt, do material, da execução ou da conversa que sustenta a causa."),
        onde: z.enum(ONDE_ESTA_A_CAUSA).describe("Onde está a causa — e, portanto, onde mexer."),
      }),
    )
    .describe("De 1 a 4 causas, da mais provável para a menos provável."),
  perguntas: z
    .array(
      z.object({
        pergunta: z.string().describe("Pergunta curta, só quando a correção depende de uma decisão do dono."),
        opcoes: z.array(z.string()).optional().describe("De 2 a 5 respostas possíveis."),
        resposta_livre: z.boolean().optional(),
        sugestao: z.string().optional(),
      }),
    )
    .describe(`De 0 a ${MAX_PERGUNTAS_DA_CORRECAO} perguntas. Vazio quando já dá para propor a correção.`),
});
export type SaidaDoDiagnostico = z.infer<typeof saidaDoDiagnosticoSchema>;

export interface Hipotese {
  causa: string;
  evidencia: string;
  onde: OndeEstaACausa;
}

export interface Diagnostico {
  resumo: string;
  hipoteses: Hipotese[];
  perguntas: Array<{ pergunta: string; opcoes: string[]; resposta_livre: boolean; sugestao: string | null }>;
}

/** O diagnóstico que a tela devolve ao pedir a proposta (é o que ela recebeu). */
export const diagnosticoSchema = z.strictObject({
  resumo: z.string().max(1000),
  hipoteses: z
    .array(
      z.strictObject({
        causa: z.string().max(500),
        evidencia: z.string().max(1500),
        onde: z.enum(ONDE_ESTA_A_CAUSA),
      }),
    )
    .max(4),
});

export const entradaDaPropostaSchema = z.strictObject({
  problema: problemaSchema,
  conversation_id: z.string().uuid().optional(),
  anexos: anexosSchema,
  historico: historicoSchema,
  diagnostico: diagnosticoSchema,
});

const materialGeradoSchema = z.object({
  tipo: z.enum(["faq", "documento"]),
  nome: z.string(),
  itens: z.array(z.object({ pergunta: z.string(), resposta: z.string() })).optional(),
  texto: z.string().optional(),
  por_que: z.string().describe("Por que este material resolve parte do problema."),
});

export const saidaDaPropostaSchema = z.object({
  explicacao: z.string().describe("Em 1 a 3 frases, o que a correção muda e por que resolve o problema."),
  system_prompt: z
    .string()
    .describe("O prompt COMPLETO corrigido. O que não precisa mudar fica igual, palavra por palavra."),
  mudancas_no_prompt: z
    .array(z.object({ o_que: z.string(), por_que: z.string() }))
    .describe("Cada mudança no prompt, em linguagem simples. Vazio se o prompt não muda."),
  materiais_novos: z
    .array(materialGeradoSchema)
    .describe(`De 0 a ${TETO_DE_MATERIAIS_NOVOS} materiais a criar — só com fatos que o dono informou.`),
  materiais_desligar: z
    .array(z.object({ nome: z.string(), por_que: z.string() }))
    .describe("Materiais ligados hoje que atrapalham (desatualizados, contraditórios). Vazio na maioria das vezes."),
  pacotes_ligar: z.array(z.object({ pacote: z.enum(IDS_DE_PACOTE), por_que: z.string() })),
  pacotes_desligar: z.array(z.object({ pacote: z.enum(IDS_DE_PACOTE), por_que: z.string() })),
  frases_de_passagem_adicionar: z.array(z.string()).describe("Frases do cliente que devem chamar uma pessoa na hora."),
  frases_de_passagem_remover: z.array(z.string()),
  mensagem_de_teste: z
    .string()
    .describe("Uma mensagem de cliente que reproduz o problema, para testar antes e depois."),
});
export type SaidaDaProposta = z.infer<typeof saidaDaPropostaSchema>;

const materialNovoSchema = z
  .strictObject({
    tipo: z.enum(["faq", "documento"]),
    nome: z.string().trim().min(2).max(120),
    itens: z
      .array(z.strictObject({ pergunta: z.string().trim().min(1).max(1000), resposta: z.string().trim().min(1).max(5000) }))
      .max(TETO_DE_ITENS_POR_FAQ)
      .optional(),
    texto: z.string().trim().max(60_000).optional(),
    por_que: z.string().trim().max(600).default(""),
  })
  .refine((m) => (m.tipo === "faq" ? (m.itens?.length ?? 0) > 0 : (m.texto?.length ?? 0) > 0), {
    message: "Material sem conteúdo.",
  });
export type MaterialNovo = z.infer<typeof materialNovoSchema>;

const comMotivo = <T extends z.ZodTypeAny>(valor: T) => z.strictObject({ valor, por_que: z.string().max(600).default("") });

/**
 * A proposta normalizada — o que a tela mostra e devolve, desmarcando o que
 * não quer, para ser aplicado. Tudo é RELATIVO à versão base: o servidor
 * confere que a base ainda é a vigente antes de aplicar.
 */
export const propostaSchema = z.strictObject({
  base_version_id: z.string().uuid(),
  explicacao: z.string().max(1000).default(""),
  system_prompt: z.string().trim().min(10).max(20_000),
  mudancas_no_prompt: z.array(z.strictObject({ o_que: z.string().max(500), por_que: z.string().max(600) })).max(12),
  materiais_novos: z.array(materialNovoSchema).max(TETO_DE_MATERIAIS_NOVOS),
  /** Materiais ligados hoje que a correção desliga do agente (o material continua existindo). */
  materiais_desligar: z.array(comMotivo(z.string().uuid())).max(20),
  pacotes_ligar: z.array(comMotivo(z.enum(IDS_DE_PACOTE))).max(IDS_DE_PACOTE.length),
  pacotes_desligar: z.array(comMotivo(z.enum(IDS_DE_PACOTE))).max(IDS_DE_PACOTE.length),
  frases_de_passagem_adicionar: z.array(z.string().trim().min(1).max(60)).max(20),
  frases_de_passagem_remover: z.array(z.string().trim().min(1).max(60)).max(20),
  mensagem_de_teste: z.string().max(1000).default(""),
});
export type Proposta = z.infer<typeof propostaSchema>;

/** O que a pessoa manteve marcado — a mesma forma da proposta, com o que desmarcou fora. */
export const entradaDaAplicacaoSchema = z.strictObject({
  problema: problemaSchema,
  proposta: propostaSchema,
  /** false = a pessoa recusou a mudança no prompt (as outras ainda valem). */
  aceitar_prompt: z.boolean(),
});
export type EntradaDaAplicacao = z.infer<typeof entradaDaAplicacaoSchema>;
