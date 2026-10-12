/**
 * Conferência DETERMINÍSTICA do prompt que o construtor escreveu.
 *
 * O meta-prompt pede um prompt que cumpra a doutrina (`doutrina.ts`); este
 * arquivo confere se cumpriu, sem perguntar a outro modelo. É barato, é igual
 * toda vez, e pega justamente o que modelo nenhum confessa: seção esquecida,
 * exemplo que não veio, e — o mais caro — preço, porcentagem, telefone ou
 * endereço de site que aparece no prompt mas NÃO está no que o dono contou.
 * Um agente que diz um preço inventado obriga a empresa a honrá-lo.
 *
 * Nível `erro` = o prompt não deve ir ao cliente assim (a rota pede UMA
 * correção ao modelo, só com os achados). Nível `aviso` = vale a pessoa olhar
 * na revisão. Nada aqui bloqueia a criação: quem decide é quem revisa.
 *
 * Puro: o teste exercita cada regra com uma sabotagem.
 */
import type { IDS_DE_PACOTE } from "./esquemas";
import { NOME_DO_MANUAL, SECOES_OBRIGATORIAS } from "./doutrina";

export type NivelDoAchado = "erro" | "aviso";

export interface Achado {
  nivel: NivelDoAchado;
  regra:
    | "secao_faltando"
    | "secao_fora_de_ordem"
    | "tamanho"
    | "exemplos"
    | "markdown"
    | "proibicao_sem_alternativa"
    | "maiusculas"
    | "contradicao"
    | "fato_inventado"
    | "capacidade_sem_pacote"
    | "manual_faltando";
  /** O que está errado, em linguagem de quem revisa. */
  mensagem: string;
  /** O pedaço do prompt que motivou o achado, quando houver. */
  trecho?: string;
}

export interface EntradaDaVerificacao {
  prompt: string;
  /** Tudo o que o dono informou: material colado, respostas, anexos. É a fonte dos fatos. */
  fonte: string;
  pacotes: ReadonlyArray<(typeof IDS_DE_PACOTE)[number]>;
}

export const TAMANHO_MINIMO = 2_500;
export const TAMANHO_MAXIMO = 16_000;

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function linhasDeTitulo(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((l) => normalizar(l.trim()).replace(/^\d+[.)]\s*/, ""))
    .filter((l) => l.endsWith(":"));
}

function verificarSecoes(prompt: string): Achado[] {
  const titulos = linhasDeTitulo(prompt);
  const achados: Achado[] = [];
  const posicoes: number[] = [];
  for (const secao of SECOES_OBRIGATORIAS) {
    const alvo = `${normalizar(secao)}:`;
    const i = titulos.indexOf(alvo);
    if (i === -1) {
      achados.push({ nivel: "erro", regra: "secao_faltando", mensagem: `Falta a seção "${secao}".` });
    } else {
      posicoes.push(i);
    }
  }
  const emOrdem = posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]!);
  if (!emOrdem) {
    achados.push({
      nivel: "aviso",
      regra: "secao_fora_de_ordem",
      mensagem: "As seções estão fora da ordem padrão — o agente segue melhor quando a ordem é sempre a mesma.",
    });
  }
  return achados;
}

/** O texto da seção "Exemplos" até a próxima linha de título (ou o fim). */
function secaoDeExemplos(prompt: string): string {
  const linhas = prompt.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => normalizar(l.trim()).replace(/^\d+[.)]\s*/, "") === "exemplos:");
  if (inicio === -1) return "";
  const resto = linhas.slice(inicio + 1);
  const titulos = new Set(SECOES_OBRIGATORIAS.map((s) => `${normalizar(s)}:`));
  const fim = resto.findIndex((l) => titulos.has(normalizar(l.trim()).replace(/^\d+[.)]\s*/, "")));
  return (fim === -1 ? resto : resto.slice(0, fim)).join("\n");
}

function verificarExemplos(prompt: string): Achado[] {
  const trocas = (secaoDeExemplos(prompt).match(/^\s*-?\s*cliente\s*:/gim) ?? []).length;
  if (trocas === 0) {
    return [{ nivel: "erro", regra: "exemplos", mensagem: "A seção de exemplos não tem nenhuma troca \"Cliente: … / Você: …\"." }];
  }
  if (trocas < 3) {
    return [
      {
        nivel: "aviso",
        regra: "exemplos",
        mensagem: `Só ${trocas} exemplo(s) de conversa. De 3 a 5 mostram melhor o tom e os casos difíceis.`,
      },
    ];
  }
  return [];
}

function verificarMarkdown(prompt: string): Achado[] {
  const linha = prompt.split(/\r?\n/).find((l) => /^\s*#{1,6}\s/.test(l) || /\|\s*-{3,}/.test(l));
  return linha
    ? [
        {
          nivel: "erro",
          regra: "markdown",
          mensagem: "O prompt usa título com # ou tabela. Agente instruído com markdown responde com markdown, e o WhatsApp não mostra.",
          trecho: linha.trim().slice(0, 120),
        },
      ]
    : [];
}

/** Sinais de que a proibição diz o que fazer no lugar. */
const ALTERNATIVA = /em vez|no lugar|diga|chame|passe|ofere[cç]a|explique|responda|encaminhe|pergunte|informe|oriente|confirme|consulte|→|->/i;

function verificarProibicoes(prompt: string): Achado[] {
  const semAlternativa = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    // "NUNCA:" sozinho é o cabeçalho da lista, não uma proibição.
    .filter((l) => !/^-?\s*nunca\s*:?\s*$/i.test(l))
    .filter((l) => /\bnunca\b|\bnão (dê|de|prometa|invente|informe|fale|use|envie|ofereça)\b/i.test(l))
    .filter((l) => !ALTERNATIVA.test(l));
  return semAlternativa.slice(0, 3).map((l) => ({
    nivel: "aviso" as const,
    regra: "proibicao_sem_alternativa" as const,
    mensagem: "Proibição sem dizer o que fazer no lugar. O agente obedece melhor quando sabe a alternativa.",
    trecho: l.slice(0, 160),
  }));
}

/** Siglas que são maiúsculas por natureza e não contam como grito. */
const SIGLAS = new Set(["LGPD", "CDC", "CFM", "SAMU", "CPF", "CNPJ", "CEP", "FAQ", "URL", "PIX", "SUS", "CRM", "ANS", "CRO", "CREA", "OAB", "IPTU", "FGTS", "SMS", "PDF"]);
export const TETO_DE_PALAVRAS_EM_MAIUSCULA = 8;

function verificarMaiusculas(prompt: string): Achado[] {
  const gritos = (prompt.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}\b/g) ?? []).filter((p) => !SIGLAS.has(p));
  return gritos.length > TETO_DE_PALAVRAS_EM_MAIUSCULA
    ? [
        {
          nivel: "aviso",
          regra: "maiusculas",
          mensagem: `${gritos.length} palavras em maiúscula. Use maiúscula só nas regras em que errar custa caro (preço, dinheiro, dado pessoal) — se tudo é urgente, nada é.`,
        },
      ]
    : [];
}

const TERMOS_SENSIVEIS = ["preco", "desconto", "brinde", "link", "horario", "frete", "prazo", "reembolso", "parcela"];

function verificarContradicoes(prompt: string): Achado[] {
  const linhas = prompt.split(/\r?\n/).map(normalizar);
  const nunca = linhas.filter((l) => /\bnunca\b/.test(l));
  const sempre = linhas.filter((l) => /\bsempre\b/.test(l));
  const achados: Achado[] = [];
  for (const termo of TERMOS_SENSIVEIS) {
    if (nunca.some((l) => l.includes(termo)) && sempre.some((l) => l.includes(termo))) {
      achados.push({
        nivel: "aviso",
        regra: "contradicao",
        mensagem: `"${termo}" aparece numa regra com "nunca" e noutra com "sempre". Confira se as duas não se contradizem — quando conflitam, o agente segue a que vier por último.`,
      });
    }
  }
  return achados;
}

// ───────────────────────────── fatos inventados ─────────────────────────────

/** "1.200,50" → "1200"; "150" → "150". Só a parte inteira, sem separador de milhar. */
function inteiroDe(numero: string): string {
  const semDecimal = numero.split(",")[0] ?? numero;
  return semDecimal.replace(/[.\s]/g, "").replace(/^0+(?=\d)/, "");
}

function numerosDe(texto: string): Set<string> {
  const saida = new Set<string>();
  for (const m of texto.matchAll(/\d[\d.]*(?:,\d+)?/g)) saida.add(inteiroDe(m[0]));
  return saida;
}

function hostDe(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]!
    .toLowerCase();
}

function verificarFatos(prompt: string, fonte: string): Achado[] {
  const numerosDaFonte = numerosDe(fonte);
  const digitosDaFonte = fonte.replace(/\D/g, "");
  const fonteMinuscula = fonte.toLowerCase();
  const achados: Achado[] = [];
  const vistos = new Set<string>();
  const registrar = (trecho: string, oQue: string) => {
    if (vistos.has(trecho)) return;
    vistos.add(trecho);
    achados.push({
      nivel: "erro",
      regra: "fato_inventado",
      mensagem: `${oQue} "${trecho}" está no prompt, mas não no que você contou. Se for real, inclua no material; se não, o agente não pode dizer.`,
      trecho,
    });
  };

  for (const m of prompt.matchAll(/R\$\s?(\d[\d.]*(?:,\d+)?)/g)) {
    if (!numerosDaFonte.has(inteiroDe(m[1]!))) registrar(m[0], "O valor");
  }
  for (const m of prompt.matchAll(/(\d+(?:,\d+)?)\s?%/g)) {
    if (!numerosDaFonte.has(inteiroDe(m[1]!))) registrar(m[0], "A porcentagem");
  }
  for (const m of prompt.matchAll(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g)) {
    const digitos = m[0].replace(/\D/g, "");
    if (digitos.length < 10) continue;
    if (!digitosDaFonte.includes(digitos.slice(-8))) registrar(m[0].trim(), "O telefone");
  }
  for (const m of prompt.matchAll(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi)) {
    if (!fonteMinuscula.includes(hostDe(m[0]))) registrar(m[0], "O endereço");
  }
  return achados;
}

function verificarCapacidades(prompt: string, pacotes: EntradaDaVerificacao["pacotes"]): Achado[] {
  const texto = normalizar(prompt);
  const achados: Achado[] = [];
  if (/(chame|passe|transfira|encaminhe)[^.\n]{0,40}(pessoa|equipe|atendente|humano)/.test(texto) && !pacotes.includes("escalar")) {
    achados.push({
      nivel: "aviso",
      regra: "capacidade_sem_pacote",
      mensagem: 'O prompt manda passar para uma pessoa, mas a capacidade "Passar para um humano" está desligada.',
    });
  }
  if (/(agende|marque|programe)[^.\n]{0,30}(retorno|follow|lembrete)/.test(texto) && !pacotes.includes("reter")) {
    achados.push({
      nivel: "aviso",
      regra: "capacidade_sem_pacote",
      mensagem: 'O prompt promete agendar retorno, mas a capacidade "Não perder o cliente" está desligada.',
    });
  }
  return achados;
}

export function verificarPrompt({ prompt, fonte, pacotes }: EntradaDaVerificacao): Achado[] {
  const tamanho = prompt.trim().length;
  const tamanhoAchado: Achado[] =
    tamanho < TAMANHO_MINIMO
      ? [{ nivel: "aviso", regra: "tamanho", mensagem: `Prompt curto (${tamanho} caracteres): provavelmente faltam regras ou exemplos.` }]
      : tamanho > TAMANHO_MAXIMO
        ? [{ nivel: "aviso", regra: "tamanho", mensagem: `Prompt longo (${tamanho} caracteres): regra repetida dilui a importante. Mova detalhes para os materiais.` }]
        : [];
  const achados = [
    ...verificarSecoes(prompt),
    ...verificarFatos(prompt, fonte),
    ...verificarMarkdown(prompt),
    ...verificarExemplos(prompt),
    ...tamanhoAchado,
    ...verificarProibicoes(prompt),
    ...verificarMaiusculas(prompt),
    ...verificarContradicoes(prompt),
    ...verificarCapacidades(prompt, pacotes),
  ];
  return [...achados.filter((a) => a.nivel === "erro"), ...achados.filter((a) => a.nivel === "aviso")];
}

/** Aviso quando o "Manual de conduta" não está entre os materiais. */
export function verificarManual(materiais: ReadonlyArray<{ nome: string }>): Achado[] {
  return materiais.some((m) => m.nome.startsWith(NOME_DO_MANUAL))
    ? []
    : [
        {
          nivel: "aviso",
          regra: "manual_faltando",
          mensagem: `O "${NOME_DO_MANUAL}" não está nos materiais. Sem ele, o agente não tem o guia das situações difíceis.`,
        },
      ];
}

/** Os achados de nível erro, em texto, para o pedido de correção ao modelo. */
export function pedidoDeCorrecao(achados: readonly Achado[]): string {
  const erros = achados.filter((a) => a.nivel === "erro");
  return [
    "O prompt que você escreveu tem estes problemas. Corrija APENAS isto e devolva o agente completo, mantendo todo o resto igual:",
    ...erros.map((a, i) => `${i + 1}. ${a.mensagem}`),
    'Para fato que não está no que o dono contou: tire o valor do prompt e escreva a regra "se perguntarem, diga que vai confirmar com a equipe".',
  ].join("\n");
}
