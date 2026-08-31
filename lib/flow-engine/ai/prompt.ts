/**
 * Flow Engine — o "manual" que a IA lê antes de interpretar ou montar um fluxo.
 *
 * Gerado a partir do REGISTRY, nunca escrito à mão: rótulo, descrição e
 * exemplo de cada tipo vêm de `todosOsNos()` + `configExemploDoTipo` — as
 * MESMAS fontes que a paleta do editor e o clique manual "acrescentar bloco"
 * usam. Um 12º tipo registrado amanhã entra automaticamente na próxima
 * chamada; ninguém precisa lembrar de atualizar um prompt escrito à parte.
 */
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";
import { todosOsNos } from "../registry";

function manualDosBlocos(): string {
  garantirNosRegistrados();
  return todosOsNos()
    .map((def) => {
      const exemplo = JSON.stringify(configExemploDoTipo(def.type));
      return `- ${def.type} ("${def.rotulo}"): ${def.descricao}\n  Exemplo de config: ${exemplo}`;
    })
    .join("\n");
}

interface Mensagem {
  papel: "usuario" | "ia";
  texto: string;
}

function historicoComoTexto(historico: readonly Mensagem[]): string {
  if (historico.length === 0) return "(nenhuma troca anterior)";
  return historico.map((m) => `${m.papel === "usuario" ? "Pessoa" : "IA"}: ${m.texto}`).join("\n");
}

/**
 * System prompt da Rota A (`interpretar`): decide se precisa perguntar algo
 * antes de montar, ou se já pode avançar.
 */
export function promptDeInterpretacao(): string {
  return `Você ajuda a montar um fluxo de automação de CRM a partir do que a pessoa descreveu.

Os tipos de bloco disponíveis são exatamente estes — nenhum outro existe:
${manualDosBlocos()}

Sua tarefa AGORA não é montar o fluxo. É decidir se você tem informação
suficiente para montá-lo bem, ou se falta algo importante que só a pessoa sabe
responder (por exemplo: qual etiqueta usar, qual texto mandar, quanto tempo
esperar, se deve avisar um vendedor específico ou distribuir por rodízio).

Se faltar algo, faça UMA pergunta objetiva com opções de múltipla escolha
(2 a 5 opções). Prefira perguntar a assumir um valor que muda o comportamento
do fluxo — mas não pergunte o que já pode ser um padrão razoável (ex.: não
pergunte "5 minutos ou 10 minutos de espera" se a pessoa não deu nenhum
indício de que o tempo importa; escolha um padrão sensato e diga isso no
resumo).

Se você já tem o suficiente, devolva um resumo curto do plano (1-2 frases,
em português, para a pessoa confirmar que entendeu o que vai ser montado).`;
}

/**
 * System prompt da Rota B (`gerar`): monta o grafo de verdade.
 */
export function promptDeGeracao(): string {
  return `Você monta um fluxo de automação de CRM em formato de grafo.

Os tipos de bloco disponíveis são exatamente estes — nunca invente um tipo
fora desta lista:
${manualDosBlocos()}

Regras do grafo:
- O primeiro bloco é sempre um "trigger" (hoje só existe trigger.lead_created).
- Toda aresta (edge) sai de um bloco por um "branch_id" — "else" é a saída
  padrão de todo bloco (o "senão"/"depois disso"). Blocos com decisão (como
  logic.if) têm saídas extras, com o id que você escolheu para cada uma.
- Não deixe nenhum caminho "solto" sem motivo: todo bloco que não seja um fim
  de linha deve ter uma aresta saindo dele.
- Use "logic.end" para marcar onde o fluxo termina.
- IDs de bloco são curtos e você mesmo escolhe (ex.: "n1", "checa_score").
- NÃO invente variáveis de template fora de "{{lead.title}}",
  "{{lead.score}}", "{{vars.dono_escolhido}}" e campos parecidos de lead/contact.

Monte o fluxo que a pessoa pediu, usando o histórico da conversa (incluindo as
respostas que ela já deu às suas perguntas) para preencher os detalhes.`;
}

export function promptDoUsuario(pedido: string, historico: readonly Mensagem[]): string {
  return `Pedido original: ${pedido}\n\nConversa até agora:\n${historicoComoTexto(historico)}`;
}

export type { Mensagem };
