/**
 * SONDA DE "CRIAR FLUXO COM IA" — roda contra o provedor REAL, imprime o cru.
 *
 * ═══ Por que existe ═══
 *
 * O passo de montar o fluxo falhou quatro vezes seguidas, e as quatro correções
 * foram feitas às cegas: a única informação disponível era a frase genérica na
 * tela ("A IA não conseguiu terminar o fluxo"). Duas das quatro consertaram
 * defeitos reais que NÃO eram a causa. Cada rodada custou um deploy.
 *
 * Esta sonda existe para que a próxima decisão seja tomada sobre evidência.
 * Ela roda na VPS de quem tem o problema, com a chave de quem tem o problema, e
 * imprime o que o servidor não mostra:
 *
 *   --modo=cru   monta o HTTP à mão, EXATAMENTE como o `@ai-sdk/openai` monta,
 *                e imprime status, cabeçalhos e o CORPO BRUTO da resposta. É o
 *                único jeito de ver o que a OpenRouter respondeu sem um SDK
 *                traduzindo o erro para "Provider returned error".
 *   --modo=sdk   roda o caminho REAL (`generateObject`, o mesmo das rotas) e
 *                imprime `finishReason`, `warnings`, `usage` e — quando a
 *                validação recusa — os caminhos do Zod.
 *
 * ═══ As etapas são as da produção ═══
 *
 * `--etapa=plano` mede a etapa 1 (quais blocos) e `--etapa=config` mede a etapa
 * 2 (os campos de UM bloco). Não há etapa que peça o grafo inteiro: esse
 * caminho foi removido do produto, e uma sonda que ainda o medisse responderia
 * sobre um pedido que ninguém faz — pior que sonda nenhuma.
 *
 * ═══ O que ela NÃO faz ═══
 *
 * Não grava nada: sem banco, sem audit, sem arquivo. É sonda, não mutação. E
 * não decide nada — imprime, e quem lê decide.
 *
 * ═══ A chave nunca aparece ═══
 *
 * `mascarar()` corta o valor de toda chave conhecida de tudo que é impresso,
 * inclusive de eco de cabeçalho. Vigiado por `diagnostico-fluxo-ia.test.ts`.
 *
 * Uso:
 *   pnpm ia:diagnostico --etapa=plano  --modo=ambos
 *   pnpm ia:diagnostico --etapa=plano  --modo=cru --require-parameters
 *   pnpm ia:diagnostico --etapa=config --tipo=logic.if --modo=sdk --org=<uuid>
 */
import { generateObject } from "ai";
import { z } from "zod";

import { OPENROUTER_BASE_URL, DEFAULT_BOT_MODEL, idNaOpenRouter } from "@/lib/ai/gateway";
import { schemaDeConfigParaGeracao } from "@/lib/flow-engine/ai/config-para-geracao";
import { montarSchemaDePlano } from "@/lib/flow-engine/ai/plan-schema";
import {
  promptDeConfig,
  promptDePlano,
  promptDoBloco,
  promptDoUsuario,
} from "@/lib/flow-engine/ai/prompt";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";

const PEDIDO_PADRAO =
  "Quando entrar um lead novo, espera 10 minutos; se ninguém tiver falado com ele, " +
  "avisa o vendedor dono do lead no WhatsApp e coloca a etiqueta 'sem resposta'.";

/** O tipo medido por `--etapa=config` quando ninguém passa `--tipo`. */
const TIPO_PADRAO = "whatsapp.notify_user";

export interface Opcoes {
  etapa: "plano" | "config";
  modo: "cru" | "sdk" | "ambos";
  orgId: string | null;
  modelo: string | null;
  tipo: string;
  pedido: string;
  requireParameters: boolean;
  bytes: number;
}

/** As chaves que nunca podem aparecer na saída, em nenhuma forma. */
function segredos(): string[] {
  return [
    process.env.OPENROUTER_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.AI_GATEWAY_API_KEY,
  ].filter((v): v is string => typeof v === "string" && v.length >= 8);
}

/**
 * Troca toda ocorrência de chave por `***`.
 *
 * Aplicado na SAÍDA, não na entrada: o corpo bruto de um erro da OpenRouter
 * pode ecoar o cabeçalho `Authorization` de volta, e um `console.log` direto
 * publicaria a chave no terminal de quem pediu ajuda — e, com frequência, num
 * print colado numa issue pública.
 */
export function mascarar(texto: string, chaves: readonly string[] = segredos()): string {
  let saida = texto;
  for (const chave of chaves) saida = saida.split(chave).join("***");
  return saida;
}

function fala(...partes: unknown[]): void {
  // stderr: mensagem operacional (convenção do scripts/README.md).
  console.error(mascarar(partes.map((p) => String(p)).join(" ")));
}

function despeja(rotulo: string, valor: unknown): void {
  // stdout: saída estruturada, consumível por pipe — é o contrato de script
  // deste repo (`scripts/README.md`), e é o que permite `... | grep finishReason`.
  // eslint-disable-next-line no-console -- ver acima; a proibição mira código de runtime
  console.log(mascarar(`${rotulo}: ${typeof valor === "string" ? valor : JSON.stringify(valor)}`));
}

export function lerOpcoes(argv: readonly string[]): Opcoes {
  const mapa = new Map<string, string>();
  for (const bruto of argv) {
    if (!bruto.startsWith("--")) continue;
    const [chave, ...resto] = bruto.slice(2).split("=");
    mapa.set(chave!, resto.length > 0 ? resto.join("=") : "sim");
  }
  return {
    etapa: (mapa.get("etapa") ?? "plano") as Opcoes["etapa"],
    modo: (mapa.get("modo") ?? "ambos") as Opcoes["modo"],
    orgId: mapa.get("org") ?? null,
    modelo: mapa.get("modelo") ?? null,
    tipo: mapa.get("tipo") ?? TIPO_PADRAO,
    pedido: mapa.get("pedido") ?? PEDIDO_PADRAO,
    requireParameters: mapa.has("require-parameters"),
    bytes: Number(mapa.get("bytes") ?? 4000),
  };
}

export interface PedidoDaEtapa {
  schema: z.ZodTypeAny;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

/**
 * O pedido exato que a produção faria naquela etapa.
 *
 * Os `maxOutputTokens` são os mesmos das rotas (1200 no plano, 800 por config).
 * Divergir aqui mediria um pedido diferente do que quebra, que é o modo de
 * falha mais caro de uma sonda.
 */
export function pedidoDaEtapa(o: Opcoes): PedidoDaEtapa {
  if (o.etapa === "plano") {
    return {
      schema: montarSchemaDePlano(),
      system: promptDePlano(),
      prompt: promptDoUsuario(o.pedido, []),
      maxOutputTokens: 1200,
    };
  }

  garantirNosRegistrados();
  const def = buscarNo(o.tipo);
  if (def === undefined) throw new Error(`tipo de bloco desconhecido: ${o.tipo}`);
  const schema = schemaDeConfigParaGeracao(o.tipo);
  if (schema === null) {
    throw new Error(`o tipo ${o.tipo} não tem campo nenhum — a produção nem chama o modelo`);
  }
  return {
    schema,
    system: promptDeConfig(o.tipo, def.rotulo, def.descricao),
    prompt: promptDoBloco({
      pedido: o.pedido,
      rotulo: def.rotulo,
      intencao: o.pedido,
      vizinhos: "é o primeiro bloco do fluxo",
    }),
    maxOutputTokens: 800,
  };
}

/** Conta `anyOf`/`oneOf` em qualquer profundidade — é a métrica que já mordeu. */
export function contarUnioes(no: unknown): { anyOf: number; oneOf: number } {
  let anyOf = 0;
  let oneOf = 0;
  const fila: unknown[] = [no];
  while (fila.length > 0) {
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      fila.push(...atual);
      continue;
    }
    if (typeof atual !== "object" || atual === null) continue;
    for (const [chave, valor] of Object.entries(atual)) {
      if (chave === "anyOf") anyOf += 1;
      if (chave === "oneOf") oneOf += 1;
      fila.push(valor);
    }
  }
  return { anyOf, oneOf };
}

/**
 * O corpo HTTP, montado como o `@ai-sdk/openai@4` monta.
 *
 * Exportado para que o teste possa provar que a sonda IMITA a produção. Sonda
 * que diverge do caminho real é pior que sonda nenhuma: ela responde sobre um
 * pedido que ninguém faz.
 */
export function corpoDaChamada(args: {
  modelo: string;
  schema: unknown;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  requireParameters: boolean;
}): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    model: args.modelo,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.prompt },
    ],
    temperature: 0.2,
    max_tokens: args.maxOutputTokens,
    response_format: {
      type: "json_schema",
      json_schema: { schema: args.schema, strict: false, name: "response" },
    },
  };
  if (args.requireParameters) {
    // A OpenRouter só GARANTE que o provedor upstream honra o `response_format`
    // quando isto vai junto; sem ele, ela pode rotear para um provedor que
    // simplesmente descarta o parâmetro — e a resposta volta em prosa.
    corpo.provider = { require_parameters: true };
  }
  return corpo;
}

async function sondaCrua(o: Opcoes, modeloCanonico: string): Promise<void> {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) {
    fala("[cru] pulado: sem OPENROUTER_API_KEY no ambiente.");
    return;
  }
  const base = process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL;
  const modeloNoProvedor = idNaOpenRouter(modeloCanonico);
  const pedido = pedidoDaEtapa(o);
  const schema = z.toJSONSchema(pedido.schema, { io: "input" });

  // Os dois ids lado a lado: já houve um defeito inteiro entre o nome canônico
  // e o nome da OpenRouter (hífen aqui, ponto lá), e ele custou um deploy.
  despeja("modelo_canonico", modeloCanonico);
  despeja("modelo_no_provedor", modeloNoProvedor);
  despeja("schema_bytes", JSON.stringify(schema).length);
  despeja("schema_unioes", contarUnioes(schema));
  despeja("require_parameters", o.requireParameters);

  const corpo = corpoDaChamada({
    modelo: modeloNoProvedor,
    schema,
    system: pedido.system,
    prompt: pedido.prompt,
    maxOutputTokens: pedido.maxOutputTokens,
    requireParameters: o.requireParameters,
  });

  const t0 = Date.now();
  const resposta = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify(corpo),
  });
  const texto = await resposta.text();

  despeja("http_status", resposta.status);
  despeja("http_ms", Date.now() - t0);
  despeja("http_headers", Object.fromEntries(resposta.headers.entries()));
  // O corpo bruto, sem SDK no meio. É onde a OpenRouter escreve o motivo real.
  despeja("corpo_bruto", texto.slice(0, o.bytes));
}

/** Os caminhos que o Zod recusou — `blocos.3.tipo` em vez de "falhou". */
export function caminhosRecusados(error: unknown, teto = 12): string[] {
  const visto = new Set<string>();
  const fila: unknown[] = [error];
  while (fila.length > 0 && visto.size < teto) {
    const atual = fila.shift();
    if (typeof atual !== "object" || atual === null) continue;
    const e = atual as { issues?: unknown; cause?: unknown };
    if (Array.isArray(e.issues)) {
      for (const bruto of e.issues) {
        if (typeof bruto !== "object" || bruto === null) continue;
        const issue = bruto as { path?: unknown };
        if (Array.isArray(issue.path)) visto.add(issue.path.join("."));
        if (visto.size >= teto) break;
      }
    }
    if (e.cause !== undefined) fila.push(e.cause);
  }
  return [...visto];
}

/** O que o provedor devolveu junto do erro — status e corpo, truncados. */
function detalheDoErro(err: unknown, bytes: number): Record<string, unknown> {
  if (typeof err !== "object" || err === null) return {};
  const e = err as { statusCode?: unknown; responseBody?: unknown; text?: unknown };
  const saida: Record<string, unknown> = {};
  if (typeof e.statusCode === "number") saida.status = e.statusCode;
  if (typeof e.responseBody === "string") saida.corpo = e.responseBody.slice(0, bytes);
  // `AI_NoObjectGeneratedError` guarda em `text` o que o modelo REALMENTE
  // respondeu — é o que separa "veio prosa" de "veio JSON recusado".
  if (typeof e.text === "string") saida.texto_do_modelo = e.text.slice(0, bytes);
  return saida;
}

async function sondaPeloSdk(o: Opcoes, modeloCanonico: string): Promise<void> {
  const { resolverModeloDoPonto } = await import("@/lib/ai/gateway-binding");
  const { resolveLanguageModel } = await import("@/lib/ai/gateway");

  const resolvido = o.orgId
    ? await resolverModeloDoPonto("flow_ai_gerar", o.orgId, modeloCanonico)
    : (() => {
        const model = resolveLanguageModel(modeloCanonico);
        return model ? { model, modelId: modeloCanonico, origem: "padrao" as const } : null;
      })();

  if (!resolvido) {
    fala("[sdk] pulado: nenhum provedor configurado no ambiente.");
    return;
  }

  despeja("sdk_modelo", resolvido.modelId);
  despeja("sdk_origem", resolvido.origem);

  const pedido = pedidoDaEtapa(o);
  const t0 = Date.now();
  try {
    // `generateObject` e não `streamObject`: é o que as rotas fazem hoje. A
    // geração por etapas não usa streaming — cada resposta é pequena e chega
    // inteira, e é o streaming que transformava erro em stream truncado.
    const gerado = await generateObject({
      model: resolvido.model,
      schema: pedido.schema as z.ZodType<unknown>,
      system: pedido.system,
      prompt: pedido.prompt,
      temperature: 0.2,
      maxOutputTokens: pedido.maxOutputTokens,
      providerOptions: { openai: { strictJsonSchema: false } },
    });
    despeja("sdk_ms", Date.now() - t0);
    // O discriminador: "length" acusa teto de tokens; "stop" acusa a validação.
    despeja("sdk_finishReason", gerado.finishReason);
    despeja("sdk_warnings", gerado.warnings ?? []);
    despeja("sdk_usage", gerado.usage ?? {});
    despeja("sdk_objeto", JSON.stringify(gerado.object).slice(0, o.bytes));
  } catch (err) {
    despeja("sdk_ms", Date.now() - t0);
    despeja("sdk_erro", err instanceof Error ? err.message : String(err));
    despeja("sdk_caminhos_recusados", caminhosRecusados(err));
    for (const [chave, valor] of Object.entries(detalheDoErro(err, o.bytes))) {
      despeja(`sdk_erro_${chave}`, valor);
    }
  }
}

async function principal(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  const modeloCanonico = o.modelo ?? DEFAULT_BOT_MODEL;

  fala(
    `[sonda] etapa=${o.etapa}${o.etapa === "config" ? ` tipo=${o.tipo}` : ""} ` +
      `modo=${o.modo} modelo=${modeloCanonico}`,
  );
  if (o.modo === "cru" || o.modo === "ambos") await sondaCrua(o, modeloCanonico);
  if (o.modo === "sdk" || o.modo === "ambos") await sondaPeloSdk(o, modeloCanonico);
  fala("[sonda] fim.");
}

// Guarda explícita em vez de comparar `import.meta.url` com `argv[1]`: essa
// comparação erra em Windows (barra invertida, letra de unidade) justamente na
// máquina de quem desenvolve, e o modo de falha seria a sonda DISPARAR REDE
// dentro do teste. `VITEST` é posto pelo runner e não existe em execução real.
if (!process.env.VITEST) {
  void principal().catch((err) => {
    fala("[sonda] estourou:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
