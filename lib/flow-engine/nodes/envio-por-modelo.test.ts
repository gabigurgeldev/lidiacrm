/**
 * OS BLOCOS DE ENVIO MANDANDO DEFINIÇÃO APROVADA.
 *
 * ─── Por que isto faltava, e o que custava ──────────────────────────────────
 *
 * `whatsapp.bulk_send` já tinha modo de modelo; os dois blocos 1:1 não. O
 * efeito não é "uma opção a menos": numa conexão oficial, fora da janela de 24h,
 * a plataforma RECUSA texto livre. O bloco tentava, a mensagem não saía, e o
 * fluxo seguia pela saída "Não saiu agora" — quando havia uma. O caminho de
 * volta existia no inbox (um humano escolhia um modelo) e não existia em
 * automação nenhuma, que é justamente onde não há humano olhando.
 *
 * ─── O que estes casos prendem ──────────────────────────────────────────────
 *
 * Que o modo escolhido CHEGA à porta (e não vira texto pelo caminho); que os
 * valores do modelo passam por `render` como o texto passa; e que o schema
 * recusa na TELA as combinações que a plataforma recusaria no envio.
 */
import { describe, expect, it } from "vitest";

import { notifyUserConfigSchema, whatsappNotifyUser } from "./avisos";
import { enviarAoClienteConfigSchema, whatsappEnviarAoCliente } from "./enviar-ao-cliente";
import { criarMundoDeTeste } from "../teste/mundo";
import { rodarTickDeFluxos } from "../engine";
import type { FlowGraph } from "../graph-schema";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

const CANAL = "3f2b9f7e-0000-4000-8000-aaaaaaaaaaaa";

function grafoDeEnvio(config: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("manda", "whatsapp.send_to_lead", {
        tipo: "texto",
        texto: "",
        canal_id: CANAL,
        ...config,
      }),
    ],
    edges: [aresta("e1", "inicio", "manda")],
  };
}

describe("mandar para o cliente por definição aprovada", () => {
  it("⭐ o modelo chega à porta, e o texto livre NÃO vai junto", async () => {
    const mundo = criarMundoDeTeste();
    await rodarTickDeFluxos(
      mundo.montar(
        grafoDeEnvio({
          modo: "template",
          modelo_nome: "confirmacao_pedido",
          modelo_idioma: "pt_BR",
          modelo_valores: { "1": "Ana" },
        }),
      ),
    );

    expect(mundo.enviadosAoCliente).toHaveLength(1);
    expect(mundo.enviadosAoCliente[0]!.modelo).toEqual({
      nome: "confirmacao_pedido",
      idioma: "pt_BR",
      valores: { "1": "Ana" },
    });
  });

  it("⭐ os valores do modelo passam por render, como o texto passa", async () => {
    // Sem isto, o modelo só serviria para texto fixo — e a razão de um modelo
    // ter parâmetro é justamente carregar o nome de quem recebe.
    const mundo = criarMundoDeTeste();
    await rodarTickDeFluxos(
      mundo.montar(
        grafoDeEnvio({
          modo: "template",
          modelo_nome: "boas_vindas",
          modelo_idioma: "pt_BR",
          modelo_valores: { "1": "{{contact.name}}", "2": "{{lead.title}}" },
        }),
      ),
    );

    const enviado = mundo.enviadosAoCliente[0]!;
    expect(enviado.modelo?.valores["1"]).not.toContain("{{");
    expect(enviado.modelo?.valores["1"]).toBe("Gabriel");
    expect(enviado.modelo?.valores["2"]).toBe("Loja do Gabriel");
  });

  it("⭐ no modo livre, NENHUM modelo é mandado", async () => {
    // A porta é a mesma; o que muda é o campo. Um `modelo` vazio indo junto
    // faria todo envio de texto virar template na plataforma.
    const mundo = criarMundoDeTeste();
    await rodarTickDeFluxos(mundo.montar(grafoDeEnvio({ texto: "Oi!" })));

    expect(mundo.enviadosAoCliente[0]!.modelo).toBeUndefined();
    expect(mundo.enviadosAoCliente[0]!.texto).toBe("Oi!");
  });
});

describe("o schema recusa na tela o que a plataforma recusaria no envio", () => {
  const base = { tipo: "texto", texto: "", canal_id: null };

  it("⭐ modo template sem nome ou sem idioma não publica", () => {
    // `pt_BR` e `pt` são definições DISTINTAS: nome sem idioma não endereça
    // nenhuma, e a plataforma responderia 132001 com o lead esperando.
    expect(
      enviarAoClienteConfigSchema.safeParse({ ...base, modo: "template", modelo_nome: "x" }).success,
    ).toBe(false);
    expect(
      enviarAoClienteConfigSchema.safeParse({ ...base, modo: "template", modelo_idioma: "pt_BR" })
        .success,
    ).toBe(false);
    expect(
      enviarAoClienteConfigSchema.safeParse({
        ...base,
        modo: "template",
        modelo_nome: "x",
        modelo_idioma: "pt_BR",
      }).success,
    ).toBe(true);
  });

  it("⭐ modelo com mídia avulsa é recusado, em vez de sair sem a mídia", () => {
    // O link de um cabeçalho de mídia vai DENTRO do parâmetro da definição.
    // Aceitar os dois daria a impressão de que se combinam.
    const r = enviarAoClienteConfigSchema.safeParse({
      tipo: "imagem",
      texto: "",
      media_url: "https://exemplo.com/a.png",
      canal_id: null,
      modo: "template",
      modelo_nome: "x",
      modelo_idioma: "pt_BR",
    });
    expect(r.success).toBe(false);
  });

  it("texto livre continua exigindo texto — a garantia mudou de lugar, não sumiu", () => {
    expect(enviarAoClienteConfigSchema.safeParse({ ...base, modo: "freeform" }).success).toBe(false);
    expect(
      enviarAoClienteConfigSchema.safeParse({ ...base, modo: "freeform", texto: "Oi" }).success,
    ).toBe(true);
  });
});

describe("avisar o vendedor por definição aprovada", () => {
  it("⭐ o modelo chega à porta do aviso", async () => {
    const mundo = criarMundoDeTeste();
    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("avisa", "whatsapp.notify_user", {
          destinatario: { tipo: "telefone", telefone: "+5511999998888" },
          mensagem: "",
          modo: "template",
          modelo_nome: "lead_novo",
          modelo_idioma: "pt_BR",
          modelo_valores: { "1": "{{lead.title}}" },
          canal_id: null,
        }),
      ],
      edges: [aresta("e1", "inicio", "avisa")],
    };
    await rodarTickDeFluxos(mundo.montar(grafo));

    expect(mundo.enviados).toHaveLength(1);
    expect(mundo.enviados[0]!.modelo?.nome).toBe("lead_novo");
    expect(mundo.enviados[0]!.modelo?.valores["1"]).toBe("Loja do Gabriel");
  });

  it("⭐ a mensagem deixou de ser obrigatória, mas SÓ no modo de modelo", () => {
    // No modo livre ela continua sendo o que o vendedor lê: sem ela o aviso
    // chegaria em branco, que é o mesmo que não avisar.
    const destinatario = { tipo: "dono_do_lead" as const };
    expect(
      notifyUserConfigSchema.safeParse({
        destinatario,
        mensagem: "",
        modo: "template",
        modelo_nome: "x",
        modelo_idioma: "pt_BR",
      }).success,
    ).toBe(true);
    expect(notifyUserConfigSchema.safeParse({ destinatario, mensagem: "" }).success).toBe(false);
  });
});
