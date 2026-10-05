/**
 * Monta a requisição de um endpoint — o lugar onde o id da conta entra.
 *
 * ═══ A REGRA QUE ESTE ARQUIVO EXISTE PARA GUARDAR ═══
 *
 * O modelo escolhe VALORES de parâmetros declarados. Ele nunca escolhe a conta:
 * `{{conta.id}}` e `{{conta.email}}` vêm da verificação que o runtime fez com o
 * código digitado pelo cliente, e `{{contato.telefone}}` vem da linha do job.
 *
 * Três camadas, e cada uma fecha uma porta diferente:
 *
 *   1. valor de parâmetro que vai no CAMINHO não pode carregar estrutura de URL
 *      (`/`, `\`, `?`, `#`, `%`, `.`/`..`) — senão `{{params.pedido}}` =
 *      `../../contas/outra/diagnostico` trocaria a conta pelo caminho;
 *   2. o valor é codificado (`encodeURIComponent`);
 *   3. PÓS-CONDIÇÃO: a URL final tem a MESMA origem da `base_url` e o caminho
 *      começa pelo caminho da base. Se as duas primeiras falharem por um
 *      descuido futuro, esta recusa assim mesmo.
 */
import {
  lerParametros,
  placeholdersDoTexto,
  type Metodo,
  type Parametro,
} from "@/lib/ai/integracoes/schema";

export type SessaoDaConta = { contaId: string; contaEmail: string } | null;

export type EndpointParaMontar = {
  metodo: Metodo;
  caminho: string;
  parametros: unknown;
  corpo_fixo?: Record<string, unknown> | null;
};

export type RequisicaoMontada = {
  url: string;
  metodo: Metodo;
  /** JSON serializado, ou null quando não há corpo. */
  corpo: string | null;
};

export type ErroDeMontagem =
  | "identidade_necessaria"
  | "parametro_invalido_no_caminho"
  | "marcador_desconhecido"
  | "destino_fora_da_base"
  | "base_url_invalida";

export type ResultadoDaMontagem =
  | { ok: true; requisicao: RequisicaoMontada }
  | { ok: false; erro: ErroDeMontagem; detalhe?: string };

const ESTRUTURA_DE_URL_RX = /[/\\?#%]/;

function valorSeguroNoCaminho(valor: string): boolean {
  if (valor.length === 0) return false;
  if (valor === "." || valor === "..") return false;
  return !ESTRUTURA_DE_URL_RX.test(valor);
}

function resolverDoServidor(
  bruto: string,
  sessao: SessaoDaConta,
  telefone: string | null,
): { ok: true; valor: string } | { ok: false; erro: ErroDeMontagem } {
  if (bruto === "conta.id") {
    return sessao ? { ok: true, valor: sessao.contaId } : { ok: false, erro: "identidade_necessaria" };
  }
  if (bruto === "conta.email") {
    return sessao ? { ok: true, valor: sessao.contaEmail } : { ok: false, erro: "identidade_necessaria" };
  }
  if (bruto === "contato.telefone") {
    return telefone ? { ok: true, valor: telefone } : { ok: false, erro: "marcador_desconhecido" };
  }
  return { ok: false, erro: "marcador_desconhecido" };
}

/** Troca `{{conta.*}}`/`{{contato.*}}` em strings do corpo fixo (recursivo, sem params). */
function substituirNoCorpoFixo(
  valor: unknown,
  sessao: SessaoDaConta,
  telefone: string | null,
): { ok: true; valor: unknown } | { ok: false; erro: ErroDeMontagem } {
  if (typeof valor === "string") {
    let falha: ErroDeMontagem | null = null;
    const novo = valor.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, bruto: string) => {
      const r = resolverDoServidor(bruto.trim(), sessao, telefone);
      if (!r.ok) {
        falha = r.erro;
        return "";
      }
      return r.valor;
    });
    return falha ? { ok: false, erro: falha } : { ok: true, valor: novo };
  }
  if (Array.isArray(valor)) {
    const out: unknown[] = [];
    for (const item of valor) {
      const r = substituirNoCorpoFixo(item, sessao, telefone);
      if (!r.ok) return r;
      out.push(r.valor);
    }
    return { ok: true, valor: out };
  }
  if (valor && typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      const r = substituirNoCorpoFixo(v, sessao, telefone);
      if (!r.ok) return r;
      out[k] = r.valor;
    }
    return { ok: true, valor: out };
  }
  return { ok: true, valor };
}

/**
 * Monta URL e corpo. `valores` já passou pelo validador `.strict()` do endpoint
 * (`construirValidadorDeParametros`); aqui a pergunta é outra — onde cada valor
 * vai e se ele mudaria o destino.
 */
export function montarRequisicao(input: {
  baseUrl: string;
  endpoint: EndpointParaMontar;
  valores: Record<string, string | number | boolean>;
  sessao: SessaoDaConta;
  telefoneDoContato?: string | null;
}): ResultadoDaMontagem {
  let base: URL;
  try {
    base = new URL(input.baseUrl);
  } catch {
    return { ok: false, erro: "base_url_invalida" };
  }
  const telefone = input.telefoneDoContato ?? null;
  const parametros: Parametro[] = lerParametros(input.endpoint.parametros);
  const porNome = new Map(parametros.map((p) => [p.nome, p]));
  const usadosNoCaminho = new Set<string>();

  // 1 · caminho
  let caminho = input.endpoint.caminho;
  for (const ph of placeholdersDoTexto(input.endpoint.caminho)) {
    let valor: string;
    if (ph.fonte === "params") {
      const bruto = input.valores[ph.nome];
      if (bruto === undefined) {
        return { ok: false, erro: "parametro_invalido_no_caminho", detalhe: ph.nome };
      }
      valor = String(bruto);
      if (!valorSeguroNoCaminho(valor)) {
        return { ok: false, erro: "parametro_invalido_no_caminho", detalhe: ph.nome };
      }
      usadosNoCaminho.add(ph.nome);
    } else if (ph.fonte === "desconhecida") {
      return { ok: false, erro: "marcador_desconhecido", detalhe: ph.bruto };
    } else {
      const r = resolverDoServidor(ph.bruto, input.sessao, telefone);
      if (!r.ok) return { ok: false, erro: r.erro, detalhe: ph.bruto };
      // O id que o sistema externo devolveu também é dado de fora: se trouxer
      // estrutura de URL, recusa em vez de confiar.
      if (!valorSeguroNoCaminho(r.valor)) {
        return { ok: false, erro: "parametro_invalido_no_caminho", detalhe: ph.bruto };
      }
      valor = r.valor;
    }
    const marcador = new RegExp(`\\{\\{\\s*${escaparRegex(ph.bruto)}\\s*\\}\\}`, "g");
    caminho = caminho.replace(marcador, () => encodeURIComponent(valor));
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.origin);
  url.pathname = `${basePath}${caminho}`;

  // 2 · query e corpo
  const semCorpo = input.endpoint.metodo === "GET" || input.endpoint.metodo === "DELETE";
  const corpo: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(input.valores)) {
    if (usadosNoCaminho.has(nome)) continue;
    const p = porNome.get(nome);
    if (!p) continue; // o validador .strict() já recusou; aqui é só defesa
    if (p.onde === "path") continue; // declarado no caminho e ausente do texto: ignora
    if (p.onde === "body" && !semCorpo) corpo[nome] = valor;
    else url.searchParams.set(nome, String(valor));
  }

  let corpoFinal: Record<string, unknown> | null = null;
  if (!semCorpo) {
    const fixo = substituirNoCorpoFixo(input.endpoint.corpo_fixo ?? {}, input.sessao, telefone);
    if (!fixo.ok) return { ok: false, erro: fixo.erro };
    // Os valores do modelo NÃO sobrescrevem o corpo fixo: o fixo é decisão de
    // quem configurou (ex.: `{"conta": "{{conta.id}}"}`).
    corpoFinal = { ...corpo, ...(fixo.valor as Record<string, unknown>) };
  }

  // 3 · pós-condição
  const final = url.toString();
  const conferida = new URL(final);
  if (conferida.origin !== base.origin) return { ok: false, erro: "destino_fora_da_base" };
  if (basePath && !(conferida.pathname === basePath || conferida.pathname.startsWith(`${basePath}/`))) {
    return { ok: false, erro: "destino_fora_da_base" };
  }
  if (/(^|\/)\.\.?(\/|$)/.test(conferida.pathname)) return { ok: false, erro: "destino_fora_da_base" };

  return {
    ok: true,
    requisicao: {
      url: final,
      metodo: input.endpoint.metodo,
      corpo: corpoFinal === null ? null : JSON.stringify(corpoFinal),
    },
  };
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renderiza o texto de confirmação de uma ação com os valores CONGELADOS. Só
 * `{{params.x}}` — a conta não aparece no texto que vai para o chat.
 */
export function renderizarConfirmacao(
  texto: string,
  valores: Record<string, string | number | boolean>,
): string {
  return texto.replace(/\{\{\s*params\.([a-z][a-z0-9_]{0,30})\s*\}\}/g, (_m, nome: string) => {
    const v = valores[nome];
    return v === undefined ? "" : String(v);
  });
}
