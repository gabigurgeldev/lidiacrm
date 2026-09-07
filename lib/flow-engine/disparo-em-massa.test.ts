/**
 * O BLOCO DE DISPARO EM MASSA — o que ele faz, e sobretudo o que ele NÃO faz.
 *
 * ## O que este arquivo protege
 *
 * 1. **Ele não manda mensagem.** Quem manda é o motor de disparos, com ritmo,
 *    teto diário, janela e opt-out. Se algum dia este bloco começar a enviar
 *    direto, a regra de "este contato pediu para parar" passa a ter duas
 *    versões — e é assim que uma instalação manda campanha para quem saiu.
 * 2. **Ele nasce em rascunho, e AVISA.** Um fluxo não tem ninguém olhando; a
 *    campanha criada e esquecida é pior que a não criada, porque parece que
 *    funcionou. O aviso na Central é o que faz alguém aparecer.
 * 3. **Recusa não mata a execução.** O resto do fluxo (marcar o lead, avisar o
 *    vendedor) continua fazendo sentido sem a campanha.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste } from "./registry";
import { criarMundoDeTeste, type MundoDeTeste } from "./teste/mundo";

const pos = { x: 0, y: 0 };
const CANAL = "11111111-2222-4333-8444-555555555555";

function grafo(over: Record<string, unknown> = {}): FlowGraph {
  return {
    nodes: [
      { id: "inicio", type: "trigger.lead_created", label: "Início", position: pos, config: {} },
      {
        id: "dispara",
        type: "whatsapp.bulk_send",
        label: "Disparo",
        position: pos,
        config: {
          nome: "Campanha do fluxo",
          canal_id: CANAL,
          modo: "freeform",
          texto: "Oi {{contact.name}}",
          modelo_nome: "",
          modelo_idioma: "",
          modelo_valores: {},
          audiencia: "tags",
          tags: ["clientes"],
          contatos: [],
          intervalo_ms: 5000,
          comecar_sozinho: false,
          ...over,
        },
      },
      { id: "fim", type: "logic.end", label: "Fim", position: pos, config: { desfecho: "ok" } },
    ],
    edges: [
      { id: "e1", source: "inicio", target: "dispara", branch_id: "else" },
      { id: "e2", source: "dispara", target: "fim", branch_id: "else" },
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

describe("o bloco de disparo em massa", () => {
  it("⭐ pede a CAMPANHA, e não manda mensagem nenhuma", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo()));

    expect(mundo.disparosPedidos).toHaveLength(1);
    // As duas portas de envio ficam intocadas: quem entrega é o motor de
    // disparos, com as travas dele.
    expect(mundo.enviados, "mandou mensagem direto, pulando o motor de disparos").toHaveLength(0);
    expect(mundo.enviadosAoCliente).toHaveLength(0);
  });

  it("interpola {{...}} no nome e no texto antes de pedir", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo({ nome: "Campanha de {{contact.name}}" })));
    const pedido = mundo.disparosPedidos[0]! as { nome: string; texto: string };
    expect(pedido.nome).toBe("Campanha de Gabriel");
    expect(pedido.texto).toBe("Oi Gabriel");
  });

  it("a audiência por marcador vira o recorte por tags", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo({ audiencia: "tags", tags: ["vip", "novo"] })));
    const pedido = mundo.disparosPedidos[0]! as {
      audiencia: { tipo: string; tags?: string[] };
    };
    expect(pedido.audiencia).toEqual({ tipo: "tags", tags: ["vip", "novo"] });
  });

  it("a lista fixa vira o recorte por contatos", async () => {
    const ids = ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"];
    await rodarTickDeFluxos(
      mundo.montar(grafo({ audiencia: "lista_fixa", tags: [], contatos: ids })),
    );
    const pedido = mundo.disparosPedidos[0]! as {
      audiencia: { tipo: string; contatos?: string[] };
    };
    expect(pedido.audiencia).toEqual({ tipo: "contatos", contatos: ids });
  });

  it("⭐ rascunho abre AVISO na Central — senão a campanha some", async () => {
    mundo.desfechoDoDisparo = {
      kind: "criado",
      disparoId: "disparo-9",
      vaoReceber: 412,
      comecou: false,
    };
    await rodarTickDeFluxos(mundo.montar(grafo()));

    expect(mundo.avisos).toHaveLength(1);
    // O número precisa estar no aviso: é ele que faz alguém decidir se olha
    // agora ou depois.
    expect(mundo.avisos[0]!.corpo).toContain("412");
  });

  it("quando começa sozinho, NÃO abre aviso", async () => {
    mundo.desfechoDoDisparo = {
      kind: "criado",
      disparoId: "disparo-9",
      vaoReceber: 10,
      comecou: true,
    };
    await rodarTickDeFluxos(mundo.montar(grafo({ comecar_sozinho: true })));
    expect(mundo.avisos).toHaveLength(0);
  });

  it("⭐ recusa não mata a execução — sai pela saída própria", async () => {
    mundo.desfechoDoDisparo = { kind: "recusado", motivo: "Conexão não encontrada." };
    await rodarTickDeFluxos(mundo.montar(grafo()));

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.context.disparo_recusado).toBe("Conexão não encontrada.");
    expect(exec.status).not.toBe("failed");
  });

  it("grava o id da campanha nas variáveis, para os blocos seguintes", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo()));
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.context.disparo_id).toBe("disparo-1");
    expect(exec.context.disparo_vao_receber).toBe(3);
  });
});
