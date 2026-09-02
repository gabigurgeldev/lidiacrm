/**
 * Cercas de ARQUITETURA do registry — o que todo nó, presente e futuro, deve
 * cumprir. Não testa comportamento de nó nenhum: testa que o contrato não é
 * cumprido "por enquanto".
 *
 * Cada cerca aqui nasceu de um modo de falha concreto, e o comentário diz qual.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { CATEGORIAS_DE_NO } from "./types";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { buscarNo, limparRegistroParaTeste, registrarNo, todosOsNos } from "./registry";

const PASTA_DOS_NOS = join(process.cwd(), "lib", "flow-engine", "nodes");

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
});

describe("o registry", () => {
  it("recusa tipo duplicado em vez de a última importação vencer por acaso", () => {
    const falso = {
      type: "logic.if",
      version: 9,
      category: "logic" as const,
      rotulo: "Impostor",
      descricao: "x",
      configSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
      branches: () => [],
      execute: async () => ({ kind: "advance" as const, branch_id: "else" }),
    };
    expect(() => registrarNo(falso)).toThrow(/duplicado/u);
  });

  it("registrar duas vezes o MESMO objeto é no-op — o register-all é idempotente", () => {
    const antes = todosOsNos().length;
    garantirNosRegistrados();
    garantirNosRegistrados();
    expect(todosOsNos().length).toBe(antes);
  });
});

describe("todo nó registrado", () => {
  it("tem tipo no formato `categoria.acao`, com a categoria batendo", () => {
    for (const no of todosOsNos()) {
      expect(no.type, `${no.type}: formato do tipo`).toMatch(/^[a-z]+\.[a-z][a-z0-9_]*$/u);
      expect(CATEGORIAS_DE_NO, `${no.type}: categoria`).toContain(no.category);
    }
  });

  it("tem rótulo e descrição em português — é o que a paleta mostra", () => {
    // Sem esta cerca, um nó novo aparece na paleta como `crm.assign_owner`, que
    // é jargão de API numa tela que a doutrina do repo obriga a ser de operação.
    for (const no of todosOsNos()) {
      expect(no.rotulo.trim().length, `${no.type}: rótulo`).toBeGreaterThan(2);
      expect(no.descricao.trim().length, `${no.type}: descrição`).toBeGreaterThan(15);
      expect(no.rotulo, `${no.type}: rótulo não pode ser o próprio tipo`).not.toBe(no.type);
    }
  });

  it("declara `eventos` se — e SÓ se — for gatilho", () => {
    // O matcher deriva a assinatura daqui. Gatilho sem eventos fica registrado
    // na tela e nunca dispara; nó comum COM eventos faria o matcher escutar um
    // evento que ninguém consome.
    for (const no of todosOsNos()) {
      if (no.category === "trigger") {
        expect(no.eventos ?? [], `${no.type}: gatilho precisa declarar eventos`).not.toHaveLength(0);
        for (const evento of no.eventos ?? []) {
          // O CHECK `event_type_format` do event_log exige este formato.
          expect(evento, `${no.type}: formato do event_type`).toMatch(
            /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u,
          );
        }
      } else {
        expect(no.eventos, `${no.type}: só gatilho declara eventos`).toBeUndefined();
      }
    }
  });

  it("tem o pega-tudo `else` por último — exceto o nó terminal, que não tem saída", () => {
    for (const no of todosOsNos()) {
      const ramos = no.branches(exemploDeConfig(no.type) as never);
      if (ramos.length === 0) continue; // logic.end
      // `logic.fork` é a única exceção, e é por construção: CADA ramo dele vira
      // uma frente de execução. Um pega-tudo aqui seria um handle no canvas que
      // a pessoa pode ligar e que nunca abre frente nenhuma — o `execute` só
      // bifurca pelos ramos declarados em `config.ramos`. Handle que não faz
      // nada é pior que handle ausente: o desenho promete um caminho que o
      // motor não percorre, e nada acusa.
      if (no.type === "logic.fork") continue;
      const ultimo = ramos[ramos.length - 1]!;
      expect(ultimo.id, `${no.type}: último ramo`).toBe("else");
      expect(ultimo.kind, `${no.type}: o último é o pega-tudo`).toBe("fallback");
      expect(
        ramos.filter((r) => r.kind === "fallback").length,
        `${no.type}: exatamente um pega-tudo`,
      ).toBe(1);
      expect(new Set(ramos.map((r) => r.id)).size, `${no.type}: ids de ramo únicos`).toBe(ramos.length);
    }
  });

  it("nó que muda o CRM DECLARA que muda", () => {
    // ⚠️ A cerca que paga a dívida: os fatos são carregados uma vez por tick, e
    // `routing.round_robin` sem `mutaCrm` atribuía o lead enquanto o
    // `whatsapp.notify_user` seguinte lia `assigned_user` como null — vendedor
    // escolhido, nunca avisado, sem erro nenhum. Medido no teste do motor.
    const mudam = ["crm.add_tag", "crm.assign_owner", "routing.round_robin", "routing.redistribute"];
    for (const type of mudam) {
      expect(buscarNo(type)?.mutaCrm, `${type} muda o CRM e precisa declarar`).toBe(true);
    }
    // Contra-prova: quem só decide NÃO declara, senão a marca perde o sentido e
    // o motor recarrega os fatos a cada nó.
    for (const type of ["logic.if", "logic.wait", "logic.end", "crm.owner_responded", "notify.internal"]) {
      expect(buscarNo(type)?.mutaCrm, `${type} não muda o CRM`).not.toBe(true);
    }
  });
});

describe("os nós não falam com o banco", () => {
  // A regra que torna todo nó testável sem Postgres. Varredura de texto e não de
  // AST de propósito: é a forma mais barata de a cerca não ter manutenção, e um
  // import de cliente de banco é literal em 100% dos casos.
  const PROIBIDOS = [
    "@/lib/supabase",
    "createAdminClient",
    "createClient",
    "@supabase/supabase-js",
    "node:fs",
    "process.env",
  ];

  const arquivos = readdirSync(PASTA_DOS_NOS).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("existe pelo menos um arquivo de nó para varrer", () => {
    // Canário: sem isto, renomear a pasta faria a varredura passar medindo zero.
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.each(arquivos)("%s não importa cliente de banco nem lê env", (arquivo) => {
    const fonte = readFileSync(join(PASTA_DOS_NOS, arquivo), "utf8");
    for (const proibido of PROIBIDOS) {
      expect(fonte, `${arquivo} usa ${proibido}`).not.toContain(proibido);
    }
  });
});

/** Config mínima válida por tipo, só para arrancar os ramos de cada nó. */
function exemploDeConfig(type: string): unknown {
  switch (type) {
    case "logic.if":
      return {
        saidas: [
          { id: "a", label: "A", quando: { combinador: "and", itens: [{ campo: "x", op: "eq", valor: 1 }] } },
        ],
      };
    case "logic.wait":
      return { duracao_ms: 300_000 };
    case "logic.end":
      return { desfecho: "fim" };
    case "logic.fork":
      return {
        ramos: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        modo: "todas",
        encontro: "junta",
      };
    case "logic.merge":
      return {};
    case "logic.loop":
      return { lista: "vars.itens", max: 5 };
    case "logic.await_event":
      return { evento: "message.received", quando: {}, prazo_ms: 3_600_000 };
    case "flow.call":
      return { fluxo_id: "00000000-0000-0000-0000-000000000000", entrada: {} };
    case "crm.add_tag":
      return { tag: "x" };
    case "crm.assign_owner":
      return { user_id: "u" };
    case "crm.owner_responded":
      return { contar_a_partir_de: "desde_o_inicio_do_fluxo" };
    case "routing.round_robin":
    case "routing.redistribute":
      return { quando_ninguem: "tentar_depois", tentar_de_novo_em_ms: 300_000 };
    case "whatsapp.notify_user":
      return { destinatario: { tipo: "dono_do_lead" }, mensagem: "oi" };
    case "notify.internal":
      return { titulo: "t", corpo: "c", severidade: "warn" };
    default:
      return {};
  }
}
