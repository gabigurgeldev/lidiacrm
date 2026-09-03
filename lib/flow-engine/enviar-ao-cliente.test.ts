/**
 * O BLOCO QUE FALA COM O CLIENTE — ponta a ponta, sobre o mundo falso.
 *
 * ## Por que este arquivo existe
 *
 * Até este bloco, o motor de fluxos sabia avisar o VENDEDOR e não sabia falar
 * com o cliente. A distância entre as duas coisas é de uma linha de código e de
 * um mundo inteiro de consequência: `whatsapp.notify_user` manda para um
 * telefone da equipe e marca o contato como interno, justamente para o agente de
 * IA não puxar conversa com ele. Se o bloco novo herdasse esse comportamento por
 * descuido, ele calaria o agente na conversa de um cliente de verdade.
 *
 * Os casos abaixo cobrem, em ordem de gravidade:
 *
 *   1. a mensagem chega ao CONTATO do funil (e não a um telefone avulso);
 *   2. `{{...}}` é interpolado ANTES de sair — senão o cliente lê o código;
 *   3. lead sem telefone sai por uma saída própria, e não trava o fluxo;
 *   4. "na fila" NÃO é falha: a mensagem saiu do CRM e espera a vez no canal;
 *   5. a conexão escolhida no bloco é a que viaja até a porta.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste } from "./registry";
import { criarMundoDeTeste, type MundoDeTeste } from "./teste/mundo";

const pos = { x: 0, y: 0 };

function grafo(config: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      { id: "inicio", type: "trigger.lead_created", label: "Início", position: pos, config: {} },
      {
        id: "manda",
        type: "whatsapp.send_to_lead",
        label: "Mandar para o cliente",
        position: pos,
        config,
      },
      {
        id: "fim",
        type: "logic.end",
        label: "Fim",
        position: pos,
        config: { desfecho: "mandou" },
      },
    ],
    edges: [
      { id: "e1", source: "inicio", target: "manda", branch_id: "else" },
      { id: "e2", source: "manda", target: "fim", branch_id: "else" },
    ],
  };
}

let mundo: MundoDeTeste;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
});

describe("mandar mensagem para o cliente", () => {
  it("⭐ manda para o CONTATO do funil, não para um telefone avulso", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo({ tipo: "texto", texto: "Oi!", canal_id: null })));

    expect(mundo.enviadosAoCliente).toHaveLength(1);
    expect(mundo.enviadosAoCliente[0]!.contactId).toBe("contato-1");
    // A porta do aviso ao vendedor NÃO pode ter sido usada: ela cria contato
    // interno com `force_human`, que calaria o agente numa conversa de cliente.
    expect(
      mundo.enviados,
      "usou a porta do aviso ao vendedor para falar com o cliente",
    ).toHaveLength(0);
  });

  it("⭐ interpola {{...}} ANTES de enviar", async () => {
    // Sem isto o cliente recebe, literalmente, "Oi {{contact.name}}".
    await rodarTickDeFluxos(
      mundo.montar(grafo({ tipo: "texto", texto: "Oi {{contact.name}}!", canal_id: null })),
    );
    expect(mundo.enviadosAoCliente[0]!.texto).toBe("Oi Gabriel!");
  });

  it("a conexão escolhida no bloco é a que chega na porta", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    await rodarTickDeFluxos(
      mundo.montar(grafo({ tipo: "texto", texto: "Oi", canal_id: id })),
    );
    expect(mundo.enviadosAoCliente[0]!.channelSessionId).toBe(id);
  });

  it("sem conexão escolhida, a porta recebe null (a primeira viva)", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo({ tipo: "texto", texto: "Oi", canal_id: null })));
    expect(mundo.enviadosAoCliente[0]!.channelSessionId).toBeNull();
  });

  it("mídia viaja com o tipo e o endereço", async () => {
    await rodarTickDeFluxos(
      mundo.montar(
        grafo({
          tipo: "imagem",
          texto: "Olha a planta",
          media_url: "https://exemplo.test/planta.png",
          canal_id: null,
        }),
      ),
    );
    const enviado = mundo.enviadosAoCliente[0]!;
    expect(enviado.tipo).toBe("imagem");
    expect(enviado.mediaUrl).toBe("https://exemplo.test/planta.png");
  });

  it("⭐ 'na fila' NÃO desvia o fluxo — a mensagem saiu do CRM", async () => {
    // Fora da janela, número em aquecimento: o canal segura, o CRM já entregou.
    // Tratar isso como erro faria o fluxo desviar de um envio que vai acontecer.
    mundo.desfechoDoEnvio = { kind: "na_fila", motivo: "fora_da_janela" };
    const m = mundo.montar(grafo({ tipo: "texto", texto: "Oi", canal_id: null }));
    await rodarTickDeFluxos(m);

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.context.envio_na_fila).toBe("fora_da_janela");
    expect(exec.status, "o fluxo parou num envio que ainda vai sair").toBe("completed");
  });

  it("envio recusado sai pela saída própria, sem matar a execução", async () => {
    mundo.desfechoDoEnvio = { kind: "recusado", motivo: "contato_bloqueado" };
    await rodarTickDeFluxos(mundo.montar(grafo({ tipo: "texto", texto: "Oi", canal_id: null })));

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.context.envio_recusado).toBe("contato_bloqueado");
  });
});
