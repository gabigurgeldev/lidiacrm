/**
 * Flow Engine — a config com que cada bloco NASCE.
 *
 * Extraído de `app/app/flows/[id]/_components/FlowCanvas.tsx` (onde vivia
 * como `configInicial`, só para o clique "acrescentar bloco à mão") porque a
 * IA de geração (`lib/flow-engine/ai/`) precisa exatamente do mesmo exemplo
 * por tipo, para montar o "manual" que vai no system prompt. Uma cópia só:
 * bloco manual e bloco gerado por IA nascem com o MESMO exemplo, e um tipo
 * novo que ganhar exemplo aqui vale para os dois caminhos de uma vez.
 *
 * Não é enfeite: um bloco que nasce com config inválida não desenha as
 * saídas, e a pessoa (ou a IA) não tem onde ligar a primeira linha.
 */
export function configExemploDoTipo(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case "logic.if":
      return {
        saidas: [
          {
            id: "s1",
            label: "Score acima de 70",
            quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
          },
        ],
      };
    case "logic.wait":
      return { duracao_ms: 300_000 };
    case "logic.end":
      return { desfecho: "concluido" };
    case "logic.fork":
      // `encontro` aponta para o id de um `logic.merge` do MESMO grafo. Como
      // valor de queda ele nasce apontando para um nó que talvez não exista —
      // e é por isso que a validação de publicação cobra o alvo antes de o
      // fluxo poder rodar, em vez de o motor descobrir em runtime.
      return {
        ramos: [
          { id: "caminho_a", label: "Avisar o vendedor" },
          { id: "caminho_b", label: "Marcar o lead" },
        ],
        modo: "todas",
        encontro: "reencontro",
      };
    case "logic.merge":
      return {};
    case "logic.loop":
      return { lista: "vars.itens", max: 10 };
    case "logic.await_event":
      return {
        evento: "message.received",
        quando: {},
        // Uma hora. O schema exige no mínimo cinco minutos — abaixo disso o
        // relógio do worker (1×/min) não distingue uma espera da outra.
        prazo_ms: 3_600_000,
      };
    case "flow.call":
      // UUID nulo de propósito: como valor de queda ele NÃO pode apontar para
      // um fluxo real por acidente. A validação de publicação recusa, que é o
      // comportamento certo — melhor um bloco que não publica do que um que
      // chama o fluxo errado de alguém.
      return { fluxo_id: "00000000-0000-0000-0000-000000000000", entrada: {} };
    case "crm.add_tag":
      // Não pode ser `""`: `addTagConfigSchema.tag` exige min(1). Um exemplo
      // vazio passava despercebido no clique manual porque `branches()` deste
      // tipo não lê `config` — mas a IA de geração embute o `configSchema`
      // real (`lib/flow-engine/ai/generation-schema.ts`), e um exemplo
      // inválido no "manual" ensinaria a ela um padrão que o próprio schema
      // recusa.
      return { tag: "novo-lead" };
    case "crm.assign_owner":
      return { user_id: "{{vars.dono_escolhido}}" };
    case "crm.owner_responded":
      return { contar_a_partir_de: "desde_o_inicio_do_fluxo" };
    case "routing.round_robin":
    case "routing.redistribute":
      return { quando_ninguem: "tentar_depois", tentar_de_novo_em_ms: 300_000 };
    case "whatsapp.notify_user":
      return {
        destinatario: { tipo: "dono_do_lead" },
        mensagem: "Novo lead: {{lead.title}}",
      };
    case "whatsapp.send_to_lead":
      return {
        tipo: "texto",
        // Texto de queda com conteúdo de verdade: o schema exige mensagem não
        // vazia quando o tipo é texto, e um bloco que nasce inválido aparece no
        // editor sem saídas — sem nada dizendo por quê.
        texto: "Oi {{contact.name}}, tudo bem?",
        canal_id: null,
      };
    case "whatsapp.bulk_send":
      return {
        nome: "Disparo do fluxo",
        // UUID nulo de propósito, pelo mesmo motivo de `flow.call`: como valor
        // de queda ele NÃO pode apontar para uma conexão real por acidente. Uma
        // campanha saindo pelo número errado é pior que uma que não publica.
        canal_id: "00000000-0000-0000-0000-000000000000",
        modo: "freeform",
        texto: "Oi {{contact.name}}, tudo bem?",
        modelo_nome: "",
        modelo_idioma: "",
        modelo_valores: {},
        audiencia: "tags",
        tags: ["clientes"],
        contatos: [],
        intervalo_ms: 5_000,
        comecar_sozinho: false,
      };
    case "notify.internal":
      // Mesmo caso de `crm.add_tag`: `notifyInternalConfigSchema` exige
      // `titulo`/`corpo` com min(1), e o exemplo vazio nunca foi pego porque
      // este tipo também não lê `config` em `branches()`.
      return {
        titulo: "Fluxo precisa de atenção",
        corpo: "Verifique o lead {{lead.title}}.",
        severidade: "warn",
      };
    default:
      return {};
  }
}
