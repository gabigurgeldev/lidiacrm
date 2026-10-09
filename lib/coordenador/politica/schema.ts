/**
 * A política do coordenador — UM schema, usado pela tela, pela rota de
 * publicação e pelo runtime.
 *
 * Client-safe: só zod. A tela valida com este mesmo objeto antes de mandar, e a
 * rota valida de novo antes de chamar `fn_coord_publicar_politica` — o que a
 * tela aceita e o que o servidor grava não podem divergir.
 *
 * ═══ O que é dado e o que é chave ═══
 *
 * Destinos apontam para agentes e fluxos por ID (`agent_id`/`flow_id`), que
 * viram FK em `coord_politica_destinos`. Dentro da política, regras e
 * permissões se referem a destinos pela `chave` curta — é a mesma chave que o
 * agente e o decisor enxergam, e o servidor a resolve para o ID. Uma chave
 * citada que não existe na versão é recusada aqui, não descoberta no despacho.
 */
import { z } from "zod";

export const MODOS_DO_COORDENADOR = ["off", "shadow", "active"] as const;
export type ModoDoCoordenador = (typeof MODOS_DO_COORDENADOR)[number];

export const CHAVE_DE_DESTINO = /^[a-z0-9_]{1,40}$/;

const chaveSchema = z
  .string()
  .regex(CHAVE_DE_DESTINO, "Use só letras minúsculas, números e _ (até 40).");

const frases = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max).default([]);

export const destinoSchema = z
  .strictObject({
    chave: chaveSchema,
    tipo: z.enum(["agente", "fluxo"]),
    agent_id: z.string().uuid().nullable().optional(),
    flow_id: z.string().uuid().nullable().optional(),
    quando_usar: z.string().trim().max(600).default(""),
    exemplos: frases(12),
    nao_usar: frases(12),
    prioridade: z.number().int().min(0).max(100).default(0),
    permite_conduzir: z.boolean().default(true),
    permite_tarefa: z.boolean().default(false),
  })
  .superRefine((d, ctx) => {
    if (d.tipo === "agente" && (!d.agent_id || d.flow_id)) {
      ctx.addIssue({ code: "custom", message: "Destino de agente precisa de agent_id (e só dele).", path: ["agent_id"] });
    }
    if (d.tipo === "fluxo" && (!d.flow_id || d.agent_id)) {
      ctx.addIssue({ code: "custom", message: "Destino de fluxo precisa de flow_id (e só dele).", path: ["flow_id"] });
    }
    if (!d.permite_conduzir && !d.permite_tarefa) {
      ctx.addIssue({ code: "custom", message: "O destino precisa conduzir ou executar tarefa.", path: ["permite_conduzir"] });
    }
  });

export type Destino = z.infer<typeof destinoSchema>;

/**
 * Regra explícita de entrada: casa de forma INEQUÍVOCA e dispensa o modelo.
 * `contem` compara sem acento e sem caixa; `igual` exige a mensagem inteira.
 */
export const regraDeEntradaSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  quando: z.enum(["contem", "igual"]),
  termos: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  destino: chaveSchema,
});

export type RegraDeEntrada = z.infer<typeof regraDeEntradaSchema>;

/** O que um destino pode pedir ao coordenador, por chave de destino. */
export const permissaoSchema = z.strictObject({
  pode_chamar: z.array(chaveSchema).max(20).default([]),
  pode_transferir: z.array(chaveSchema).max(20).default([]),
});

export type Permissao = z.infer<typeof permissaoSchema>;

/**
 * Limites com defaults conservadores. Cada número tem a razão escrita em
 * `docs/adr/0002-coordenador-de-atendimento.md` §Limites.
 */
export const limitesSchema = z.strictObject({
  transferencias_por_janela: z.number().int().min(1).max(20).default(4),
  janela_minutos: z.number().int().min(1).max(1440).default(30),
  profundidade_max: z.number().int().min(1).max(5).default(3),
  prazo_chamada_horas: z.number().int().min(1).max(168).default(24),
  decisor_chamadas_por_hora: z.number().int().min(0).max(200).default(20),
  decisor_timeout_ms: z.number().int().min(1000).max(30000).default(8000),
  max_candidatos: z.number().int().min(1).max(20).default(12),
  confianca_minima: z.number().min(0).max(1).default(0.6),
});

export type Limites = z.infer<typeof limitesSchema>;

export const configDaPoliticaSchema = z.strictObject({
  /** Para onde vai a conversa quando nada decide (null = ninguém automático). */
  destino_padrao: chaveSchema.nullable().default(null),
  regras_de_entrada: z.array(regraDeEntradaSchema).max(50).default([]),
  permissoes: z.record(chaveSchema, permissaoSchema).default({}),
  interrupcao: z
    .strictObject({
      permitir: z.boolean().default(true),
      ao_interromper: z.enum(["pausar", "cancelar"]).default("pausar"),
    })
    .default({ permitir: true, ao_interromper: "pausar" }),
  limites: limitesSchema.default(limitesSchema.parse({})),
  decisor: z
    .strictObject({
      /** Sem modelo: só regras e continuidade decidem; ambiguidade cai no padrão. */
      usar_modelo: z.boolean().default(true),
    })
    .default({ usar_modelo: true }),
});

export type ConfigDaPolitica = z.infer<typeof configDaPoliticaSchema>;

export const politicaSchema = z
  .strictObject({
    modo: z.enum(MODOS_DO_COORDENADOR),
    channel_session_id: z.string().uuid().nullable().default(null),
    config: configDaPoliticaSchema.default(configDaPoliticaSchema.parse({})),
    destinos: z.array(destinoSchema).max(40).default([]),
  })
  .superRefine((p, ctx) => {
    const chaves = new Set<string>();
    p.destinos.forEach((d, i) => {
      if (chaves.has(d.chave)) {
        ctx.addIssue({ code: "custom", message: `Chave repetida: ${d.chave}.`, path: ["destinos", i, "chave"] });
      }
      chaves.add(d.chave);
    });
    const exige = (chave: string, path: (string | number)[]) => {
      if (!chaves.has(chave)) {
        ctx.addIssue({ code: "custom", message: `Destino desconhecido: ${chave}.`, path });
      }
    };
    if (p.config.destino_padrao !== null) exige(p.config.destino_padrao, ["config", "destino_padrao"]);
    p.config.regras_de_entrada.forEach((r, i) => exige(r.destino, ["config", "regras_de_entrada", i, "destino"]));
    for (const [origem, perm] of Object.entries(p.config.permissoes)) {
      exige(origem, ["config", "permissoes", origem]);
      perm.pode_chamar.forEach((c, i) => exige(c, ["config", "permissoes", origem, "pode_chamar", i]));
      perm.pode_transferir.forEach((c, i) => exige(c, ["config", "permissoes", origem, "pode_transferir", i]));
    }
    // Chamar com retorno exige que o destino aceite tarefa OU conduzir; um
    // destino que só conduz pode ser chamado com retorno (conduz e devolve).
  });

export type Politica = z.infer<typeof politicaSchema>;

/** Política vazia e desligada — o estado de toda conta antes de configurar. */
export function politicaInicial(): Politica {
  return politicaSchema.parse({ modo: "off" });
}

/** Chave legível a partir de um nome ("Comercial — Plano" → "comercial_plano"). */
export function chaveDoNome(nome: string, usadas: ReadonlySet<string> = new Set()): string {
  const base =
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "destino";
  let chave = base;
  let n = 2;
  while (usadas.has(chave)) chave = `${base}_${n++}`;
  return chave;
}
