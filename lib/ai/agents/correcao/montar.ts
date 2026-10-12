/**
 * Corrigir agente com IA — as partes puras: aparar o que o modelo devolveu e
 * montar a versão corrigida a partir da base.
 *
 * Usado dos DOIS lados: a tela monta a versão proposta para o "Testar a
 * correção" (ensaio, sem salvar), e a rota de aplicar monta a mesma versão para
 * gravar o rascunho. Uma função só é o que garante que o testado é o gravado.
 */
import type { ToolBundle } from "@/lib/mcp/tools/pacotes";
import type { Achado } from "@/lib/ai/agents/construtor/verificacao";
import type { VersionInput } from "@/lib/ai/agents/validation";
import type { MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";
import { TETO_DE_ITENS_POR_FAQ } from "@/lib/ai/agents/construtor/esquemas";

import {
  MAX_PERGUNTAS_DA_CORRECAO,
  TETO_DE_MATERIAIS_NOVOS,
  type Diagnostico,
  type MaterialNovo,
  type Proposta,
  type SaidaDaProposta,
  type SaidaDoDiagnostico,
} from "./esquemas";

const TETO_DE_FRASES = 20;

function unicas(lista: readonly string[], teto: number, tamanho: number): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruta of lista) {
    const v = bruta.trim().slice(0, tamanho);
    const chave = v.toLowerCase();
    if (v.length === 0 || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(v);
    if (saida.length === teto) break;
  }
  return saida;
}

export function normalizarDiagnostico(s: SaidaDoDiagnostico): Diagnostico {
  const hipoteses = s.hipoteses
    .map((h) => ({ causa: h.causa.trim().slice(0, 500), evidencia: h.evidencia.trim().slice(0, 1500), onde: h.onde }))
    .filter((h) => h.causa.length > 0)
    .slice(0, 4);
  const perguntas = s.perguntas
    .map((p) => {
      const opcoes = unicas(p.opcoes ?? [], 5, 200);
      return {
        pergunta: p.pergunta.trim().slice(0, 300),
        opcoes,
        resposta_livre: p.resposta_livre === true || opcoes.length < 2,
        sugestao: p.sugestao?.trim().slice(0, 300) || null,
      };
    })
    .filter((p) => p.pergunta.length > 0)
    .slice(0, MAX_PERGUNTAS_DA_CORRECAO);
  return {
    resumo: s.resumo.trim().slice(0, 1000) || "Não encontrei uma causa clara. Veja as hipóteses abaixo.",
    hipoteses,
    perguntas,
  };
}

/** O que a proposta precisa saber da versão base para ser aparada. */
export interface BaseDaProposta {
  id: string;
  system_prompt: string;
  handoff_keywords: readonly string[];
  /** Materiais ligados à base, com o nome — é pelo nome que o modelo os cita. */
  materiais: ReadonlyArray<{ id: string; nome: string }>;
}

function aparaMaterial(m: SaidaDaProposta["materiais_novos"][number]): MaterialNovo | null {
  const nome = m.nome.trim().slice(0, 120);
  if (nome.length < 2) return null;
  const por_que = m.por_que.trim().slice(0, 600);
  if (m.tipo === "faq") {
    const itens = (m.itens ?? [])
      .map((i) => ({ pergunta: i.pergunta.trim().slice(0, 1000), resposta: i.resposta.trim().slice(0, 5000) }))
      .filter((i) => i.pergunta.length > 0 && i.resposta.length > 0)
      .slice(0, TETO_DE_ITENS_POR_FAQ);
    return itens.length > 0 ? { tipo: "faq", nome, itens, por_que } : null;
  }
  const texto = (m.texto ?? "").trim().slice(0, 60_000);
  return texto.length > 0 ? { tipo: "documento", nome, texto, por_que } : null;
}

/**
 * A resposta do modelo, aparada para caber em `propostaSchema` e coerente com
 * a base: só desliga material que está ligado, não liga e desliga o mesmo
 * pacote, não "acrescenta" frase que já existe nem remove a que não existe.
 */
export function normalizarProposta(s: SaidaDaProposta, base: BaseDaProposta): Proposta {
  const prompt = s.system_prompt.trim().slice(0, 20_000);

  const porNome = new Map(base.materiais.map((m) => [m.nome.trim().toLowerCase(), m.id]));
  const desligarVistos = new Set<string>();
  const materiais_desligar = s.materiais_desligar.flatMap((d) => {
    const id = porNome.get(d.nome.trim().toLowerCase());
    if (!id || desligarVistos.has(id)) return [];
    desligarVistos.add(id);
    return [{ valor: id, por_que: d.por_que.trim().slice(0, 600) }];
  });

  const nomesNovos = new Set<string>();
  const materiais_novos: MaterialNovo[] = [];
  for (const m of s.materiais_novos) {
    if (materiais_novos.length === TETO_DE_MATERIAIS_NOVOS) break;
    const aparado = aparaMaterial(m);
    if (!aparado || nomesNovos.has(aparado.nome.toLowerCase())) continue;
    nomesNovos.add(aparado.nome.toLowerCase());
    materiais_novos.push(aparado);
  }

  const ligar = new Map<ToolBundle, string>();
  for (const p of s.pacotes_ligar) if (!ligar.has(p.pacote)) ligar.set(p.pacote, p.por_que.trim().slice(0, 600));
  const desligar = new Map<ToolBundle, string>();
  for (const p of s.pacotes_desligar) {
    // Ligar e desligar o mesmo pacote é contradição: nenhum dos dois vale.
    if (ligar.has(p.pacote)) {
      ligar.delete(p.pacote);
      continue;
    }
    if (!desligar.has(p.pacote)) desligar.set(p.pacote, p.por_que.trim().slice(0, 600));
  }

  const atuais = new Set(base.handoff_keywords.map((f) => f.trim().toLowerCase()));
  return {
    base_version_id: base.id,
    explicacao: s.explicacao.trim().slice(0, 1000),
    // Prompt vazio ou curto demais não substitui o que existe.
    system_prompt: prompt.length >= 10 ? prompt : base.system_prompt,
    mudancas_no_prompt: s.mudancas_no_prompt
      .map((m) => ({ o_que: m.o_que.trim().slice(0, 500), por_que: m.por_que.trim().slice(0, 600) }))
      .filter((m) => m.o_que.length > 0)
      .slice(0, 12),
    materiais_novos,
    materiais_desligar,
    pacotes_ligar: [...ligar].map(([valor, por_que]) => ({ valor, por_que })),
    pacotes_desligar: [...desligar].map(([valor, por_que]) => ({ valor, por_que })),
    frases_de_passagem_adicionar: unicas(s.frases_de_passagem_adicionar, TETO_DE_FRASES, 60).filter(
      (f) => !atuais.has(f.toLowerCase()),
    ),
    frases_de_passagem_remover: unicas(s.frases_de_passagem_remover, TETO_DE_FRASES, 60).filter((f) =>
      atuais.has(f.toLowerCase()),
    ),
    mensagem_de_teste: s.mensagem_de_teste.trim().slice(0, 1000),
  };
}

/** Pacotes cujas ferramentas estão TODAS na seleção. */
export function pacotesLigados(ferramentas: ReadonlySet<string>, mapa: MapaDePacotes): ToolBundle[] {
  return (Object.keys(mapa) as ToolBundle[]).filter((p) => {
    const lista = mapa[p] ?? [];
    return lista.length > 0 && lista.every((f) => ferramentas.has(f));
  });
}

/**
 * As ferramentas depois de ligar e desligar pacotes. Desligar um pacote não
 * tira o que pertence a OUTRO pacote que segue ligado (mesma regra de
 * `desligarPacote` no editor). `ordem`, quando vem, é a ordem do catálogo — o
 * diff de versão fica legível.
 */
export function ferramentasCorrigidas(
  atuais: readonly string[],
  ligar: readonly ToolBundle[],
  desligar: readonly ToolBundle[],
  mapa: MapaDePacotes,
  ordem?: readonly string[],
): string[] {
  let sel = new Set(atuais);
  for (const p of desligar) {
    const sobrevivem = new Set(
      pacotesLigados(sel, mapa)
        .filter((q) => q !== p)
        .flatMap((q) => mapa[q] ?? []),
    );
    const remover = new Set(mapa[p] ?? []);
    sel = new Set([...sel].filter((f) => !remover.has(f) || sobrevivem.has(f)));
  }
  for (const p of ligar) for (const f of mapa[p] ?? []) sel.add(f);

  const resultado = [...atuais.filter((f) => sel.has(f)), ...[...sel].filter((f) => !atuais.includes(f))];
  if (!ordem) return resultado;
  const posicao = new Map(ordem.map((n, i) => [n, i]));
  return [...resultado].sort((a, b) => (posicao.get(a) ?? Infinity) - (posicao.get(b) ?? Infinity));
}

export function frasesCorrigidas(atuais: readonly string[], adicionar: readonly string[], remover: readonly string[]): string[] {
  const tirar = new Set(remover.map((f) => f.trim().toLowerCase()));
  return unicas([...atuais.filter((f) => !tirar.has(f.trim().toLowerCase())), ...adicionar], TETO_DE_FRASES, 60);
}

/**
 * A versão corrigida: a base inteira (provedor, número, limites, escopo — nada
 * disso a correção toca), com o prompt, as ferramentas, as frases e o acervo
 * mudados. `idsDosMateriaisNovos` só existe no aplicar (no teste, os
 * materiais novos ainda não existem e ficam de fora — a tela avisa).
 */
export function versaoCorrigida(
  base: VersionInput,
  proposta: Proposta,
  aceitarPrompt: boolean,
  mapa: MapaDePacotes,
  opcoes: { idsDosMateriaisNovos?: readonly string[]; ordemDoCatalogo?: readonly string[] } = {},
): VersionInput {
  const desligar = new Set(proposta.materiais_desligar.map((m) => m.valor));
  const acervo = [
    ...new Set([...(base.knowledge_source_ids ?? []).filter((id) => !desligar.has(id)), ...(opcoes.idsDosMateriaisNovos ?? [])]),
  ];
  return {
    ...base,
    system_prompt: aceitarPrompt ? proposta.system_prompt : base.system_prompt,
    tool_ids: ferramentasCorrigidas(
      base.tool_ids,
      proposta.pacotes_ligar.map((p) => p.valor),
      proposta.pacotes_desligar.map((p) => p.valor),
      mapa,
      opcoes.ordemDoCatalogo,
    ),
    handoff_keywords: frasesCorrigidas(
      base.handoff_keywords ?? [],
      proposta.frases_de_passagem_adicionar,
      proposta.frases_de_passagem_remover,
    ),
    knowledge_source_ids: acervo,
  };
}

/** A linha que o histórico de versões mostra — o laço de retorno visível. */
export function resumoDaCorrecao(problema: string): string {
  const uma = problema.replace(/\s+/g, " ").trim();
  return `Correção com IA: ${uma.length > 200 ? `${uma.slice(0, 197)}…` : uma}`;
}

/** Nada marcado = nada a aplicar. */
export function propostaVazia(p: Proposta, aceitarPrompt: boolean, promptBase: string): boolean {
  return (
    (!aceitarPrompt || p.system_prompt.trim() === promptBase.trim()) &&
    p.materiais_novos.length === 0 &&
    p.materiais_desligar.length === 0 &&
    p.pacotes_ligar.length === 0 &&
    p.pacotes_desligar.length === 0 &&
    p.frases_de_passagem_adicionar.length === 0 &&
    p.frases_de_passagem_remover.length === 0
  );
}

/**
 * Os achados da conferência que a CORREÇÃO trouxe. Agente feito à mão raramente
 * segue as seções do construtor; mostrar "seção faltando" em todo prompt
 * corrigido seria ruído que a correção não causou. Mostra-se só o que piorou.
 */
export function achadosNovos(antes: readonly Achado[], depois: readonly Achado[]): Achado[] {
  const vistos = new Set(antes.map((a) => `${a.regra}|${a.mensagem}`));
  return depois.filter((a) => !vistos.has(`${a.regra}|${a.mensagem}`));
}
