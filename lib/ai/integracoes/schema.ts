/**
 * INTEGRAÇÕES VIA API — o schema central (migration 0223).
 *
 * Toda forma que mora em jsonb nestas tabelas (`ai_api_endpoints.parametros`,
 * `ai_api_verificacoes.contas`/`selecionadas`) é lida e escrita por AQUI. A
 * tela, a rota e o worker importam deste arquivo; nenhum deles lê o path solto
 * (anti-pattern 6, jsonb lock-in).
 *
 * O formato dos parâmetros é o MESMO do `GET /suporte/v1/catalogo` do Contrato
 * de Suporte v1 — a importação de catálogo é 1:1, sem tradução.
 */
import { z } from "zod";

/**
 * Teto de endpoints por versão de agente. Separado do teto de 25 ferramentas
 * (`TETO_TOOLS_POR_AGENTE`): o agente não recebe uma ferramenta por endpoint, e
 * sim quatro ferramentas fixas cujo catálogo lista os endpoints. 40 cobre seis
 * sistemas com seis ou sete endpoints cada — o caso do suporte da Gestalt.
 */
export const TETO_ENDPOINTS_POR_AGENTE = 40;

/** Teto de parâmetros por endpoint: mais que isso é formulário, não consulta. */
export const TETO_PARAMETROS_POR_ENDPOINT = 12;

export const SLUG_RX = /^[a-z][a-z0-9_]{2,40}$/;
const NOME_PARAMETRO_RX = /^[a-z][a-z0-9_]{0,30}$/;

/**
 * Nomes que o modelo NÃO pode usar como parâmetro: são as fontes que o
 * SERVIDOR preenche (`{{conta.id}}`, `{{contato.telefone}}`). Um parâmetro
 * chamado `conta` seria o caminho mais curto para o modelo escolher a conta.
 */
const NOMES_RESERVADOS = new Set(["conta", "contato", "params", "sessao"]);

export const TIPOS_DE_PARAMETRO = ["string", "integer", "number", "boolean", "enum"] as const;
export const ONDE_VAI_O_PARAMETRO = ["path", "query", "body"] as const;

export const ParametroSchema = z
  .object({
    nome: z
      .string()
      .regex(NOME_PARAMETRO_RX, "Use letras minúsculas, números e _ (começando por letra).")
      .refine((n) => !NOMES_RESERVADOS.has(n), "Nome reservado — o sistema preenche este valor."),
    tipo: z.enum(TIPOS_DE_PARAMETRO),
    obrigatorio: z.boolean().default(false),
    descricao: z.string().trim().max(200).default(""),
    valores: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    max_len: z.number().int().min(1).max(200).optional(),
    onde: z.enum(ONDE_VAI_O_PARAMETRO).default("query"),
  })
  .refine((p) => p.tipo !== "enum" || (p.valores?.length ?? 0) > 0, {
    message: "Parâmetro do tipo lista precisa das opções.",
    path: ["valores"],
  });

export type Parametro = z.infer<typeof ParametroSchema>;

export const ParametrosSchema = z
  .array(ParametroSchema)
  .max(TETO_PARAMETROS_POR_ENDPOINT)
  .refine((ps) => new Set(ps.map((p) => p.nome)).size === ps.length, "Parâmetro repetido.");

export const AUTH_TIPOS = ["nenhuma", "bearer", "header", "hmac_sha256", "suporte_v1"] as const;
export type AuthTipo = (typeof AUTH_TIPOS)[number];

export const TIPOS_DE_INTEGRACAO = ["generica", "suporte_v1"] as const;
export const MODOS_DE_IDENTIDADE = ["nenhuma", "email_otp"] as const;
export const MODOS_DE_ENDPOINT = ["leitura", "acao", "identidade"] as const;
export type ModoDeEndpoint = (typeof MODOS_DE_ENDPOINT)[number];
export const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Metodo = (typeof METODOS)[number];

const BaseUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s]+$/, "Informe a URL começando por https://")
  .transform((u) => u.replace(/\/+$/, ""));

const HeaderNomeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,60}$/, "Nome de cabeçalho inválido.");

/**
 * Cabeçalhos que a integração NÃO pode sobrescrever: são os que o próprio
 * cliente HTTP monta (assinatura, idempotência, tipo do corpo) ou que mudam o
 * destino da requisição.
 */
const HEADERS_PROIBIDOS = new Set([
  "host",
  "content-type",
  "content-length",
  "idempotency-key",
  "x-suporte-timestamp",
  "x-suporte-signature",
  "x-suporte-email-verificado",
  "x-suporte-request-id",
  "cookie",
]);

export const IntegracaoCriarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80),
    descricao: z.string().trim().max(500).optional(),
    tipo: z.enum(TIPOS_DE_INTEGRACAO).default("generica"),
    base_url: BaseUrlSchema,
    auth_tipo: z.enum(AUTH_TIPOS).default("nenhuma"),
    auth_header_nome: HeaderNomeSchema.optional(),
    identidade_modo: z.enum(MODOS_DE_IDENTIDADE).default("nenhuma"),
    sessao_horas: z.number().int().min(1).max(24).default(4),
    ativo: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.auth_tipo === "header" && !v.auth_header_nome) {
      ctx.addIssue({ code: "custom", path: ["auth_header_nome"], message: "Informe o nome do cabeçalho." });
    }
    if (v.auth_header_nome && HEADERS_PROIBIDOS.has(v.auth_header_nome.toLowerCase())) {
      ctx.addIssue({ code: "custom", path: ["auth_header_nome"], message: "Este cabeçalho é reservado." });
    }
    if (v.tipo === "suporte_v1" && v.auth_tipo !== "suporte_v1") {
      ctx.addIssue({
        code: "custom",
        path: ["auth_tipo"],
        message: "Integração de suporte usa a assinatura do Contrato de Suporte v1.",
      });
    }
  });

export const IntegracaoAtualizarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    descricao: z.string().trim().max(500).nullable().optional(),
    base_url: BaseUrlSchema.optional(),
    auth_tipo: z.enum(AUTH_TIPOS).optional(),
    auth_header_nome: HeaderNomeSchema.nullable().optional(),
    identidade_modo: z.enum(MODOS_DE_IDENTIDADE).optional(),
    identidade_endpoint_id: z.uuid().nullable().optional(),
    sessao_horas: z.number().int().min(1).max(24).optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => !v.auth_header_nome || !HEADERS_PROIBIDOS.has(v.auth_header_nome.toLowerCase()),
    { message: "Este cabeçalho é reservado.", path: ["auth_header_nome"] },
  );

export const SegredoSchema = z.object({ segredo: z.string().min(4).max(4000) }).strict();

const CaminhoSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^\//, "O caminho começa com /")
  .refine((c) => !/[\s#]/.test(c), "O caminho não pode ter espaço nem #.");

const CampoDaRespostaSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\.\*)*$/, "Use o formato campo.subcampo");

const EndpointBase = z.object({
  slug: z.string().trim().regex(SLUG_RX, "Use letras minúsculas, números e _ (3 a 41 caracteres)."),
  titulo: z.string().trim().min(1).max(80),
  descricao_para_ia: z.string().trim().max(600).default(""),
  metodo: z.enum(METODOS).default("GET"),
  caminho: CaminhoSchema,
  parametros: ParametrosSchema.default([]),
  corpo_fixo: z.record(z.string(), z.unknown()).nullable().optional(),
  modo: z.enum(MODOS_DE_ENDPOINT).default("leitura"),
  exige_identidade: z.boolean().default(false),
  texto_de_confirmacao: z.string().trim().max(500).nullable().optional(),
  campos_da_resposta: z.array(CampoDaRespostaSchema).max(40).default([]),
  timeout_ms: z.number().int().min(1000).max(15000).default(8000),
  ativo: z.boolean().default(true),
});

function conferirCoerencia(
  v: Partial<z.infer<typeof EndpointBase>>,
  ctx: z.RefinementCtx,
): void {
  if (v.modo === "acao" && (v.texto_de_confirmacao ?? "").trim().length < 5) {
    ctx.addIssue({
      code: "custom",
      path: ["texto_de_confirmacao"],
      message: "Ação precisa do texto que o cliente lê antes de responder SIM.",
    });
  }
  if (v.caminho !== undefined) {
    const nomes = new Set((v.parametros ?? []).map((p) => p.nome));
    for (const ph of placeholdersDoTexto(v.caminho)) {
      if (ph.fonte === "params" && !nomes.has(ph.nome)) {
        ctx.addIssue({
          code: "custom",
          path: ["caminho"],
          message: `O caminho usa {{params.${ph.nome}}}, que não está nos parâmetros.`,
        });
      }
      if (ph.fonte === "desconhecida") {
        ctx.addIssue({ code: "custom", path: ["caminho"], message: `Marcador desconhecido: {{${ph.bruto}}}` });
      }
      if (ph.fonte === "conta" && v.exige_identidade === false) {
        ctx.addIssue({
          code: "custom",
          path: ["exige_identidade"],
          message: "O caminho usa a conta verificada: marque 'exige identidade'.",
        });
      }
    }
  }
}

export const EndpointCriarSchema = EndpointBase.strict().superRefine(conferirCoerencia);
export const EndpointAtualizarSchema = EndpointBase.partial().strict().superRefine(conferirCoerencia);
export type EndpointCriar = z.infer<typeof EndpointCriarSchema>;

// ─────────────────────────── placeholders ───────────────────────────

export type FonteDePlaceholder = "params" | "conta" | "contato" | "desconhecida";
export type Placeholder = { bruto: string; fonte: FonteDePlaceholder; nome: string };

const PLACEHOLDER_RX = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Placeholders permitidos fora de `params.*`: só o que o servidor sabe. */
const PLACEHOLDERS_DO_SERVIDOR: Record<string, FonteDePlaceholder> = {
  "conta.id": "conta",
  "conta.email": "conta",
  "contato.telefone": "contato",
};

export function placeholdersDoTexto(texto: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const m of texto.matchAll(PLACEHOLDER_RX)) {
    const bruto = (m[1] ?? "").trim();
    const params = /^params\.([a-z][a-z0-9_]{0,30})$/.exec(bruto);
    if (params?.[1]) {
      out.push({ bruto, fonte: "params", nome: params[1] });
      continue;
    }
    const fonte = PLACEHOLDERS_DO_SERVIDOR[bruto];
    out.push({ bruto, fonte: fonte ?? "desconhecida", nome: bruto });
  }
  return out;
}

// ─────────────────────── validador dinâmico ───────────────────────

/**
 * Monta o Zod `.strict()` dos parâmetros de UM endpoint, do mesmo jeito que
 * `custom_fields` constrói o dele a partir de `pipeline.settings.fields`.
 * `.strict()` é a parte que importa: um campo que o endpoint não declarou
 * (`conta_id`, `organization_id`) é recusado, não ignorado em silêncio.
 */
export function construirValidadorDeParametros(
  parametros: readonly Parametro[],
): z.ZodType<Record<string, string | number | boolean>> {
  const shape: Record<string, z.ZodType> = {};
  for (const p of parametros) {
    let campo: z.ZodType;
    switch (p.tipo) {
      case "string":
        campo = z.string().trim().min(1).max(p.max_len ?? 200);
        break;
      case "integer":
        campo = z.coerce.number().int().min(-1e12).max(1e12);
        break;
      case "number":
        campo = z.coerce.number().min(-1e12).max(1e12);
        break;
      case "boolean":
        campo = z.boolean();
        break;
      case "enum":
        campo = z.enum((p.valores ?? []) as [string, ...string[]]);
        break;
    }
    shape[p.nome] = p.obrigatorio ? campo : campo.optional();
  }
  return z.object(shape).strict() as unknown as z.ZodType<
    Record<string, string | number | boolean>
  >;
}

// ─────────────────── o que a verificação guarda ───────────────────

export const ContaEncontradaSchema = z.object({
  integracao_id: z.uuid(),
  subject_id: z.string().min(1).max(200),
  nome: z.string().max(120).default(""),
});
export type ContaEncontrada = z.infer<typeof ContaEncontradaSchema>;

export const ContasEncontradasSchema = z.array(ContaEncontradaSchema).max(60);

/** integracao_id → subject_id escolhido. */
export const SelecionadasSchema = z.record(z.uuid(), z.string().min(1).max(200));
export type Selecionadas = z.infer<typeof SelecionadasSchema>;

/** Lê `contas` do banco sem confiar no formato; linha estragada vira lista vazia. */
export function lerContas(valor: unknown): ContaEncontrada[] {
  const r = ContasEncontradasSchema.safeParse(valor);
  return r.success ? r.data : [];
}

export function lerSelecionadas(valor: unknown): Selecionadas {
  const r = SelecionadasSchema.safeParse(valor);
  return r.success ? r.data : {};
}

/** Lê `parametros` do banco; linha estragada vira lista vazia (o endpoint segue chamável sem params). */
export function lerParametros(valor: unknown): Parametro[] {
  const r = ParametrosSchema.safeParse(valor);
  return r.success ? r.data : [];
}
