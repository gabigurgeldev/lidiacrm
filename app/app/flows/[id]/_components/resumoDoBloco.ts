/**
 * O QUE O BLOCO FAZ, em uma linha, lido da config que a pessoa preencheu.
 *
 * ## O defeito que isto fecha
 *
 * O cartão no quadro mostrava o `type` cru embaixo do rótulo — `logic.wait`,
 * `whatsapp.send_to_lead`, `routing.round_robin`. Duas consequências:
 *
 *   1. **Não diz nada a quem monta.** `logic.wait` é o nome do bloco no código;
 *      quem montou o fluxo quer saber que ESTE espera 2 dias e aquele espera 10
 *      minutos. O que distingue um do outro estava só na config, que só aparece
 *      depois de clicar no bloco.
 *   2. **É a mesma linha em blocos diferentes.** Cinco mensagens seguidas
 *      apareciam como cinco cartões `whatsapp.send_to_lead` — para saber qual
 *      era qual, clicava-se um por um.
 *
 * ## Por que aqui, e não no registry
 *
 * Mesmo argumento de `nodeVisuals.ts`, e a mesma vizinhança: isto é
 * APRESENTAÇÃO. O corte em 48 caracteres, as aspas curvas, o "{n} regras" —
 * tudo responde à largura do cartão, que o motor não conhece e não deve
 * conhecer. `FlowNodeDefinition` descreve o que o bloco EXECUTA.
 *
 * ## Por que devolve chave + valores, e não a frase pronta
 *
 * Porque a frase precisa passar por `t()`, e `t()` traduz por chave literal.
 * Montar `"Espera " + n + " minutos"` aqui produziria uma string que o
 * dicionário nunca alcança — a tela sairia em português no meio do espanhol,
 * exatamente o defeito que `i18n-espanhol-cobre-a-tela` existe para pegar. Com
 * chave fixa (`"Espera {n} minutos"`) e substituição DEPOIS da tradução, a
 * frase inteira é traduzível e só o número atravessa.
 *
 * Quem cobra que toda chave daqui tenha espanhol é `resumoDoBloco.test.ts` — o
 * gate genérico varre `t("literal")` no AST e não alcança `t(variavel)`.
 *
 * ## Tipo sem resumo não quebra nada
 *
 * Devolve `null`, e o cartão cai na `descricao` do registry. Mesma resiliência
 * deliberada de `nodeVisuals.ts`: registrar um bloco novo e esquecer deste
 * arquivo deixa o quadro menos informativo, nunca quebrado.
 */

export interface ResumoDoBloco {
  /** A chave do dicionário — em português, que é como este repo indexa. */
  chave: string;
  /** Substituições `{nome}`, aplicadas DEPOIS de traduzir. */
  valores?: Record<string, string>;
}

/** Aplica os `{nome}` de um resumo já traduzido. */
export function aplicarValores(texto: string, valores?: Record<string, string>): string {
  if (valores === undefined) return texto;
  return Object.entries(valores).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), texto);
}

// ───────────────────── leitura tolerante da config ─────────────────────
//
// A config está sendo EDITADA enquanto o cartão renderiza: metade dos campos
// pode estar ausente, e um deles pode ser do tipo errado porque o formulário
// ainda não gravou. Nada aqui pode lançar — um throw no resumo derruba a
// renderização do quadro inteiro, que é muito pior do que um cartão sem
// subtítulo.

function texto(config: Record<string, unknown>, campo: string): string | null {
  const v = config[campo];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numero(config: Record<string, unknown>, campo: string): number | null {
  const v = config[campo];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function lista(config: Record<string, unknown>, campo: string): unknown[] {
  const v = config[campo];
  return Array.isArray(v) ? v : [];
}

/** Os `label` de uma lista de objetos (`saidas`, `ramos`, `opcoes`). */
function rotulos(itens: unknown[]): string[] {
  return itens
    .map((i) => (typeof i === "object" && i !== null ? (i as { label?: unknown }).label : null))
    .filter((l): l is string => typeof l === "string" && l.trim() !== "")
    .map((l) => l.trim());
}

const LIMITE = 48;

/** Corta no limite sem partir palavra no meio, e sinaliza o corte. */
export function encurtar(s: string, limite = LIMITE): string {
  const limpo = s.replace(/\s+/gu, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  const base = espaco > limite * 0.6 ? corte.slice(0, espaco) : corte;
  return `${base.trimEnd()}…`;
}

export type UnidadeDeTempo = "segundos" | "minutos" | "horas" | "dias";

/**
 * Uma duração em milissegundos vira a MAIOR unidade que a expressa inteira.
 *
 * 90.000 ms é "90 segundos" e não "1,5 minutos": meia unidade lê pior que uma
 * unidade menor inteira. É a mesma escolha de `melhorUnidade` em
 * `forms/LogicWaitForm.tsx`, e pelo mesmo motivo — só que aqui a saída é uma
 * frase e lá são dois campos.
 */
export function duracaoLegivel(ms: number): { unidade: UnidadeDeTempo; n: string } {
  const escala: { unidade: UnidadeDeTempo; ms: number }[] = [
    { unidade: "dias", ms: 86_400_000 },
    { unidade: "horas", ms: 3_600_000 },
    { unidade: "minutos", ms: 60_000 },
    { unidade: "segundos", ms: 1_000 },
  ];
  for (const u of escala) {
    if (ms >= u.ms && ms % u.ms === 0) return { unidade: u.unidade, n: String(ms / u.ms) };
  }
  return { unidade: "segundos", n: String(Math.max(1, Math.round(ms / 1000))) };
}

/**
 * As frases de tempo, ESCRITAS UMA A UMA — e não montadas com `+`.
 *
 * Montar `"Espera " + chaveDaUnidade` produziria uma chave que só existe em
 * runtime: nenhum teste conseguiria ENUMERAR as chaves possíveis, e a cerca de
 * espanhol passaria a cobrir só as combinações que ela por acaso amostrou.
 * Escritas assim, `Object.values` devolve o conjunto inteiro — e é contra ele
 * que `quadro-do-fluxo-legivel.test.ts` cobra tradução.
 */
export const ESPERA_POR_UNIDADE: Record<UnidadeDeTempo, string> = {
  segundos: "Espera {n} segundos",
  minutos: "Espera {n} minutos",
  horas: "Espera {n} horas",
  dias: "Espera {n} dias",
};

export const PRAZO_POR_UNIDADE: Record<UnidadeDeTempo, string> = {
  segundos: "Espera {evento}, no máximo {n} segundos",
  minutos: "Espera {evento}, no máximo {n} minutos",
  horas: "Espera {evento}, no máximo {n} horas",
  dias: "Espera {evento}, no máximo {n} dias",
};

/**
 * O UUID que os exemplos usam para dizer "ainda não escolhido".
 *
 * Três blocos nascem com ele de propósito (`node-examples.ts`), para não
 * apontarem para recurso real por acidente. No cartão isso PRECISA aparecer, e
 * não como um UUID: é a diferença entre um bloco pronto e um que vai reprovar
 * na publicação — e hoje a pessoa só descobre no botão Publicar.
 */
const NAO_ESCOLHIDO = "00000000-0000-0000-0000-000000000000";

export function resumoDoBloco(
  tipo: string,
  config: Record<string, unknown>,
): ResumoDoBloco | null {
  switch (tipo) {
    // ── gatilhos ──
    case "trigger.keyword": {
      const palavras = lista(config, "palavras").filter(
        (p): p is string => typeof p === "string" && p.trim() !== "",
      );
      if (palavras.length === 0) return { chave: "Sem palavra escolhida" };
      return {
        chave:
          config["modo"] === "exata" ? "A mensagem é {palavras}" : "A mensagem contém {palavras}",
        valores: { palavras: encurtar(palavras.join(", ")) },
      };
    }
    case "trigger.webhook": {
      const nome = texto(config, "nome");
      return nome === null
        ? null
        : { chave: "Chamada de fora: {nome}", valores: { nome: encurtar(nome) } };
    }

    // ── lógica ──
    case "logic.wait": {
      const ms = numero(config, "duracao_ms");
      if (ms === null) return null;
      const { unidade, n } = duracaoLegivel(ms);
      return { chave: ESPERA_POR_UNIDADE[unidade], valores: { n } };
    }
    case "logic.if": {
      const nomes = rotulos(lista(config, "saidas"));
      if (nomes.length === 0) return { chave: "Sem regra escrita" };
      return {
        chave: nomes.length === 1 ? "Se {regras}" : "{n} regras: {regras}",
        valores: { n: String(nomes.length), regras: encurtar(nomes.join(", ")) },
      };
    }
    case "logic.end": {
      const desfecho = texto(config, "desfecho");
      return desfecho === null
        ? null
        : { chave: "Termina como {desfecho}", valores: { desfecho } };
    }
    case "logic.fork": {
      const nomes = rotulos(lista(config, "ramos"));
      if (nomes.length === 0) return null;
      return {
        chave:
          config["modo"] === "primeira"
            ? "{n} ao mesmo tempo, vale a primeira: {nomes}"
            : "{n} ao mesmo tempo, espera todas: {nomes}",
        valores: { n: String(nomes.length), nomes: encurtar(nomes.join(", ")) },
      };
    }
    case "logic.loop": {
      const de = texto(config, "lista");
      const max = numero(config, "max");
      if (de === null) return null;
      return {
        chave: max === null ? "Repete para cada {lista}" : "Repete para cada {lista}, até {max}",
        valores: { lista: encurtar(de), max: String(max ?? 0) },
      };
    }
    case "logic.await_event": {
      const evento = texto(config, "evento");
      const prazo = numero(config, "prazo_ms");
      if (evento === null) return null;
      if (prazo === null) return { chave: "Espera {evento}", valores: { evento } };
      const { unidade, n } = duracaoLegivel(prazo);
      return { chave: PRAZO_POR_UNIDADE[unidade], valores: { evento, n } };
    }
    case "logic.choice_menu": {
      const nomes = rotulos(lista(config, "opcoes"));
      if (nomes.length === 0) return { chave: "Sem opção escrita" };
      return { chave: "Espera a escolha: {opcoes}", valores: { opcoes: encurtar(nomes.join(", ")) } };
    }
    case "flow.call": {
      const id = texto(config, "fluxo_id");
      return id === null || id === NAO_ESCOLHIDO
        ? { chave: "Falta escolher o fluxo" }
        : { chave: "Chama outro fluxo e espera o resultado" };
    }

    // ── CRM ──
    case "crm.add_tag": {
      const tag = texto(config, "tag");
      return tag === null ? null : { chave: "Marca como {tag}", valores: { tag: encurtar(tag) } };
    }
    case "crm.assign_owner": {
      const quem = texto(config, "user_id");
      return quem === null
        ? null
        : { chave: "Passa o lead para {quem}", valores: { quem: encurtar(quem) } };
    }
    case "crm.owner_responded":
      return config["contar_a_partir_de"] === "desde_o_ultimo_no"
        ? { chave: "O dono respondeu depois do bloco anterior?" }
        : { chave: "O dono respondeu desde que o fluxo começou?" };

    // ── roteamento ──
    case "routing.fixed_order": {
      const ordem = lista(config, "ordem").filter((x) => x !== NAO_ESCOLHIDO);
      return ordem.length === 0
        ? { chave: "Falta montar a fila" }
        : { chave: "Fila fixa, {n} na vez", valores: { n: String(ordem.length) } };
    }

    // ── WhatsApp e avisos ──
    case "whatsapp.send_to_lead": {
      if (config["tipo"] !== undefined && config["tipo"] !== "texto") {
        return { chave: "Manda um arquivo ao cliente" };
      }
      const msg = texto(config, "texto");
      return msg === null ? null : { chave: "“{msg}”", valores: { msg: encurtar(msg) } };
    }
    case "whatsapp.notify_user": {
      const msg = texto(config, "mensagem");
      const destino = config["destinatario"];
      const paraODono =
        typeof destino === "object" &&
        destino !== null &&
        (destino as { tipo?: unknown }).tipo === "dono_do_lead";
      if (msg === null) return paraODono ? { chave: "Avisa o dono do lead" } : null;
      return {
        chave: paraODono ? "Avisa o dono: “{msg}”" : "Avisa por WhatsApp: “{msg}”",
        valores: { msg: encurtar(msg) },
      };
    }
    case "whatsapp.bulk_send": {
      const canal = texto(config, "canal_id");
      if (canal === null || canal === NAO_ESCOLHIDO) return { chave: "Falta escolher o número" };
      if (config["audiencia"] === "contatos") return { chave: "Dispara para uma lista fixa" };
      return {
        chave: "Dispara para quem tem {tags}",
        valores: {
          tags: encurtar(
            lista(config, "tags")
              .filter((x): x is string => typeof x === "string")
              .join(", "),
          ),
        },
      };
    }
    case "notify.internal": {
      const titulo = texto(config, "titulo");
      return titulo === null
        ? null
        : { chave: "Abre um aviso: {titulo}", valores: { titulo: encurtar(titulo) } };
    }

    default:
      return null;
  }
}
