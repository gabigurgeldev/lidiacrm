/**
 * Os formatos do construtor de agente — o que o modelo devolve, e o que a tela
 * manda de volta para criar.
 *
 * ═══ Dois níveis de rigor, de propósito ═══
 *
 * O que vai ao MODELO é frouxo: sem `.max()` nos textos. Um modelo que escreve
 * um FAQ de 41 itens quando o teto é 40 faria a geração do objeto falhar inteira,
 * e a pessoa perderia a geração por causa de um item a mais. Em vez disso o
 * excesso é APARADO depois (`normalizar*`), onde dá para escolher o que perder.
 *
 * O que vem da TELA para criar é rígido (`previaSchema`, strict): é input
 * externo que vai virar linha no banco, e a doutrina é Zod em todo input.
 *
 * Objeto na raiz sempre, nunca união — ver o cabeçalho de
 * `app/api/v1/flows/[id]/ai/interpretar/route.ts` para o que isso já custou.
 */
import { z } from "zod";

import type { ToolBundle } from "@/lib/mcp/tools/pacotes";

import { MAX_PERGUNTAS_POR_RODADA } from "./entrevista";
import { NICHOS } from "./nicho";

export const IDS_DE_PACOTE = [
  "atender",
  "vender",
  "reter",
  "escalar",
  "organizar",
  "evoluir",
] as const satisfies readonly ToolBundle[];

// ─────────────────────────────── entrevista ─────────────────────────────────

export const entradaDaEntrevistaSchema = z.strictObject({
  material: z.string().trim().min(20).max(30_000),
  historico: z
    .array(z.strictObject({ papel: z.enum(["usuario", "ia"]), texto: z.string().max(4000) }))
    .max(40)
    .default([]),
  rodada: z.number().int().min(1).max(10).default(1),
});

export const saidaDaEntrevistaSchema = z.object({
  kind: z
    .enum(["perguntar", "pronto"])
    .describe("'perguntar' se ainda falta algo que muda o agente; 'pronto' se já dá para montar."),
  perguntas: z
    .array(
      z.object({
        pergunta: z.string().describe("Pergunta curta e objetiva, em português."),
        opcoes: z
          .array(z.string())
          .optional()
          .describe("De 2 a 5 respostas possíveis. Vazio quando resposta_livre=true."),
        resposta_livre: z
          .boolean()
          .optional()
          .describe("true quando a resposta não cabe numa lista (preços, nomes, horários)."),
        sugestao: z.string().optional().describe("Um padrão razoável que o dono pode aceitar com um clique."),
      }),
    )
    .optional()
    .describe(`Obrigatório quando kind='perguntar': de 1 a ${MAX_PERGUNTAS_POR_RODADA} perguntas.`),
  nicho: z.enum(NICHOS).optional().describe("O ramo do negócio."),
  resumo: z
    .string()
    .optional()
    .describe("Obrigatório quando kind='pronto': o agente que será montado, em até 2 frases."),
});

export type SaidaDaEntrevista = z.infer<typeof saidaDaEntrevistaSchema>;

export interface PerguntaDaEntrevista {
  pergunta: string;
  opcoes: string[];
  resposta_livre: boolean;
  sugestao: string | null;
}

export type EntrevistaNormalizada =
  | { kind: "perguntar"; perguntas: PerguntaDaEntrevista[]; nicho: string | null }
  | {
      kind: "pronto";
      resumo: string;
      nicho: string | null;
      /** Presente quando o modelo não mandou o que prometeu e a rodada foi encerrada por nós. Só vai a log. */
      degradada?: "pronto_sem_resumo" | "perguntar_sem_pergunta";
    };

/** O resumo quando o modelo encerra sem dizer o que vai montar. */
export const RESUMO_PADRAO =
  "Já tenho o suficiente para montar o agente. O que ficou em aberto vira assunto para a equipe.";

/**
 * Apara e confere a resposta da entrevista. NUNCA devolve "incoerente".
 *
 * Pergunta sem texto, ou fechada com menos de 2 opções, é DESCARTADA — não
 * derruba a rodada inteira. Mandar à tela uma pergunta de múltipla escolha sem
 * escolhas é pior que erro, porque não parece erro.
 *
 * Quando nada sobra (ou o modelo diz `pronto` sem resumo), a entrevista ENCERRA
 * em vez de falhar. Era 502 — medido em produção (2026-10-10, org de
 * floricultura): três tentativas seguidas com o mesmo material, todas
 * "resposta sem pergunta válida e sem resumo", e a pessoa presa na primeira
 * tela sem ter como passar. Encerrar é seguro pelo mesmo motivo que o teto de
 * rodadas já encerra: o que faltou vira lacuna, e o agente passa esse assunto
 * para uma pessoa. A pergunta não feita custa menos que o agente não criado.
 */
export function normalizarEntrevista(s: SaidaDaEntrevista): EntrevistaNormalizada {
  const nicho = s.nicho ?? null;
  const resumo = (s.resumo ?? "").trim().slice(0, 400);
  if (s.kind === "pronto") {
    return resumo.length > 0
      ? { kind: "pronto", resumo, nicho }
      : { kind: "pronto", resumo: RESUMO_PADRAO, nicho, degradada: "pronto_sem_resumo" };
  }
  const perguntas: PerguntaDaEntrevista[] = [];
  for (const p of s.perguntas ?? []) {
    const texto = p.pergunta.trim().slice(0, 300);
    if (texto.length === 0) continue;
    const opcoes = (p.opcoes ?? [])
      .map((o) => o.trim().slice(0, 80))
      .filter((o) => o.length > 0)
      .slice(0, 5);
    const livre = p.resposta_livre === true || opcoes.length < 2;
    perguntas.push({
      pergunta: texto,
      // Pergunta que veio "fechada" com uma opção só vira aberta: a opção
      // solitária vai para a sugestão, em vez de virar um beco de uma porta.
      opcoes: livre ? [] : opcoes,
      resposta_livre: livre,
      sugestao: (p.sugestao?.trim() || (livre && opcoes[0]) || "").slice(0, 200) || null,
    });
    if (perguntas.length === MAX_PERGUNTAS_POR_RODADA) break;
  }
  if (perguntas.length > 0) return { kind: "perguntar", perguntas, nicho };
  return {
    kind: "pronto",
    resumo: resumo.length > 0 ? resumo : RESUMO_PADRAO,
    nicho,
    degradada: "perguntar_sem_pergunta",
  };
}

// ──────────────────────────────── geração ───────────────────────────────────

export const entradaDaGeracaoSchema = z.strictObject({
  material: z.string().trim().min(20).max(30_000),
  historico: z
    .array(z.strictObject({ papel: z.enum(["usuario", "ia"]), texto: z.string().max(4000) }))
    .max(40)
    .default([]),
  nicho: z.enum(NICHOS).optional(),
});

export const agenteGeradoSchema = z.object({
  nome: z.string().describe("Nome do agente, como ele se apresenta (ex.: 'Bia, da Clínica Sorriso')."),
  descricao: z.string().describe("Uma frase para a equipe: o que este agente faz."),
  system_prompt: z.string().describe("O prompt completo do agente, com todas as seções obrigatórias."),
  pacotes: z
    .array(z.enum(IDS_DE_PACOTE))
    .describe("Capacidades que o agente precisa, da mais importante para a menos importante."),
  handoff_keywords: z
    .array(z.string())
    .describe("Expressões curtas que, ditas pelo cliente, chamam uma pessoa na hora."),
  lacunas: z
    .array(z.string())
    .describe("O que o dono não informou e que o agente vai passar para uma pessoa em vez de responder."),
});

export const materiaisGeradosSchema = z.object({
  materiais: z.array(
    z.object({
      tipo: z.enum(["faq", "documento"]),
      nome: z.string(),
      itens: z
        .array(z.object({ pergunta: z.string(), resposta: z.string() }))
        .optional()
        .describe("Só quando tipo='faq'."),
      texto: z.string().optional().describe("Só quando tipo='documento'."),
    }),
  ),
});

// ─────────────────────── prévia (o que a tela manda) ────────────────────────

export const TETO_DE_MATERIAIS = 8;
export const TETO_DE_ITENS_POR_FAQ = 60;

const materialDaPreviaSchema = z
  .strictObject({
    tipo: z.enum(["faq", "documento"]),
    nome: z.string().trim().min(2).max(120),
    itens: z
      .array(
        z.strictObject({
          pergunta: z.string().trim().min(1).max(1000),
          resposta: z.string().trim().min(1).max(5000),
        }),
      )
      .max(TETO_DE_ITENS_POR_FAQ)
      .optional(),
    texto: z.string().trim().max(60_000).optional(),
  })
  .refine((m) => (m.tipo === "faq" ? (m.itens?.length ?? 0) > 0 : (m.texto?.length ?? 0) > 0), {
    message: "Material sem conteúdo.",
  });

export const previaSchema = z.strictObject({
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(2000).optional(),
  system_prompt: z.string().trim().min(10).max(20_000),
  pacotes: z.array(z.enum(IDS_DE_PACOTE)).max(IDS_DE_PACOTE.length),
  handoff_keywords: z.array(z.string().trim().min(1).max(60)).max(20),
  materiais: z.array(materialDaPreviaSchema).max(TETO_DE_MATERIAIS),
  channel_session_id: z.string().uuid(),
});

export type Previa = z.infer<typeof previaSchema>;
export type MaterialDaPrevia = Previa["materiais"][number];

/** A prévia SEM canal: é o que a geração devolve; o canal a tela escolhe. */
export type PreviaGerada = Omit<Previa, "channel_session_id"> & { lacunas: string[] };

function unicos(lista: string[], teto: number, tamanho: number): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of lista) {
    const v = bruto.trim().slice(0, tamanho);
    const chave = v.toLowerCase();
    if (v.length === 0 || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(v);
    if (saida.length === teto) break;
  }
  return saida;
}

/**
 * O que o modelo devolveu, aparado para caber em `previaSchema`.
 *
 * Material vazio some; nome repetido ganha sufixo — `ai_knowledge_sources`
 * tem nome único por organização, e dois "Perguntas frequentes" na mesma
 * prévia fariam a criação falhar no segundo.
 */
export function normalizarGeracao(
  agente: z.infer<typeof agenteGeradoSchema>,
  materiais: z.infer<typeof materiaisGeradosSchema>,
): PreviaGerada {
  const nomes = new Set<string>();
  const saidaMateriais: MaterialDaPrevia[] = [];
  for (const m of materiais.materiais) {
    if (saidaMateriais.length === TETO_DE_MATERIAIS) break;
    let nome = m.nome.trim().slice(0, 110);
    if (nome.length < 2) continue;
    let n = 2;
    const base = nome;
    while (nomes.has(nome.toLowerCase())) nome = `${base} (${n++})`;
    if (m.tipo === "faq") {
      const itens = (m.itens ?? [])
        .map((i) => ({ pergunta: i.pergunta.trim().slice(0, 1000), resposta: i.resposta.trim().slice(0, 5000) }))
        .filter((i) => i.pergunta.length > 0 && i.resposta.length > 0)
        .slice(0, TETO_DE_ITENS_POR_FAQ);
      if (itens.length === 0) continue;
      saidaMateriais.push({ tipo: "faq", nome, itens });
    } else {
      const texto = (m.texto ?? "").trim().slice(0, 60_000);
      if (texto.length === 0) continue;
      saidaMateriais.push({ tipo: "documento", nome, texto });
    }
    nomes.add(nome.toLowerCase());
  }

  const pacotes = [...new Set(agente.pacotes)];
  return {
    nome: agente.nome.trim().slice(0, 120) || "Atendente IA",
    descricao: agente.descricao.trim().slice(0, 2000) || undefined,
    system_prompt: agente.system_prompt.trim().slice(0, 20_000),
    pacotes,
    handoff_keywords: unicos(agente.handoff_keywords, 20, 60),
    materiais: saidaMateriais,
    lacunas: unicos(agente.lacunas, 15, 300),
  };
}
