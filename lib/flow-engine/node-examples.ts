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
