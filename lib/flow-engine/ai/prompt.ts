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
 * System prompt da ETAPA 1 da geração nova: o plano, sem nenhuma config.
 *
 * A diferença para o pedido antigo — o grafo inteiro numa resposta — não é de
 * estilo. Ali o modelo tinha de escolher, para cada bloco, uma variante entre 11
 * formas E preencher os campos daquela forma, tudo numa resposta. Aqui ele só
 * decide QUAIS blocos, em que ordem e ligados como — e o "manual" continua
 * entrando porque escolher o tipo certo exige saber o que cada tipo faz.
 */
export function promptDePlano(): string {
  return `Você planeja um fluxo de automação de CRM.

Os tipos de bloco disponíveis são exatamente estes — nunca invente um tipo
fora desta lista:
${manualDosBlocos()}

Sua tarefa AGORA é listar os blocos e as ligações. NÃO preencha os campos de
cada bloco — isso é o passo seguinte. Para cada bloco, escreva uma "intenção":
uma frase dizendo o que ele faz neste fluxo, JÁ COM os valores que a pessoa
pediu (o tempo de espera, o texto da mensagem, o nome da etiqueta). Essa frase
é o que vai permitir preencher os campos depois.

Regras do plano:
- O primeiro bloco é sempre um gatilho (hoje só existe trigger.lead_created).
- Todo bloco que não é fim de linha tem pelo menos uma ligação saindo dele.
- Use "logic.end" para marcar onde o fluxo termina.
- Em blocos que decidem (logic.if), diga na intenção QUAIS são as saídas e o
  que cada uma significa, e use o rótulo da saída no campo "ramo" da ligação.
- IDs de bloco são curtos e você mesmo escolhe (ex.: "n1", "checa_score").
- Prefira o fluxo mais simples que atenda ao pedido: menos blocos, menos ramos.

Monte o plano que a pessoa pediu, usando o histórico da conversa (incluindo as
respostas que ela já deu às suas perguntas).`;
}

/**
 * System prompt da ETAPA 2: os campos de UM bloco, isolado.
 *
 * O bloco chega sem o grafo em volta — de propósito. Arrastar o fluxo inteiro
 * para dentro de cada chamada devolveria o problema que a etapa 1 resolveu (um
 * pedido grande, com muitas formas possíveis) multiplicado pelo número de
 * blocos. O que sobrevive do contexto é a `intencao`, escrita na etapa 1
 * exatamente para isso.
 */
export function promptDeConfig(tipo: string, rotulo: string, descricao: string): string {
  return `Você preenche os campos de UM bloco de um fluxo de automação de CRM.

O bloco é do tipo "${tipo}" ("${rotulo}"): ${descricao}
Exemplo de preenchimento válido: ${JSON.stringify(configExemploDoTipo(tipo))}

Regras:
- Responda SOMENTE os campos deste bloco. Não invente campo que não existe.
- Use os valores que a intenção do bloco descreve. Onde a intenção não disser,
  escolha um padrão sensato e comum para um CRM.
- Em textos de mensagem, você pode usar "{{lead.title}}", "{{lead.score}}",
  "{{vars.dono_escolhido}}" e campos parecidos de lead/contact. Não invente
  outras variáveis.`;
}

/** O pedido da etapa 2: o bloco, a intenção dele, e o fluxo em volta em uma linha. */
export function promptDoBloco(args: {
  pedido: string;
  rotulo: string;
  intencao: string;
  vizinhos: string;
}): string {
  return `Pedido original da pessoa: ${args.pedido}

Bloco a preencher: "${args.rotulo}"
O que ele faz neste fluxo: ${args.intencao}
Onde ele fica: ${args.vizinhos}`;
}

export function promptDoUsuario(pedido: string, historico: readonly Mensagem[]): string {
  return `Pedido original: ${pedido}\n\nConversa até agora:\n${historicoComoTexto(historico)}`;
}

export type { Mensagem };
