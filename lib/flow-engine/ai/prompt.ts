/**
 * Flow Engine — o "manual" que a IA lê antes de interpretar ou montar um fluxo.
 *
 * Gerado a partir do REGISTRY, nunca escrito à mão: rótulo, descrição, saídas e
 * exemplo de cada tipo vêm de `todosOsNos()` + `configExemploDoTipo` — as
 * MESMAS fontes que a paleta do editor e o clique manual "acrescentar bloco"
 * usam. Um tipo registrado amanhã entra automaticamente na próxima chamada;
 * ninguém precisa lembrar de atualizar um prompt escrito à parte.
 *
 * ═══ ⚠️ PROSA ESCRITA À MÃO AO LADO DE MANUAL GERADO APODRECE ═══
 *
 * A regra do plano dizia, letra por letra, "hoje só existe
 * trigger.lead_created". Havia QUATRO gatilhos registrados. O manual gerado
 * logo acima listava os quatro corretamente, e a frase ao lado mandava o modelo
 * ignorar três deles — então "quando o cliente escrever ORÇAMENTO" nunca
 * escolhia o gatilho de palavra, e isso lia como limitação do modelo.
 *
 * Por isso TODA lista de tipos neste arquivo é derivada, e `prompt.test.ts`
 * reprova qualquer tipo de bloco citado em prosa que não venha do registry.
 */
import { OPERADORES } from "../condicoes";
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";
import { todosOsNos } from "../registry";
import { RAIZES_DE_VARIAVEL, type FlowBranch, type FlowNodeDefinition } from "../types";

/** O UUID de queda dos blocos que apontam para um recurso externo. */
const UUID_NULO = "00000000-0000-0000-0000-000000000000";

/**
 * As saídas de um bloco, calculadas a partir do exemplo de config.
 *
 * `branches()` de alguns tipos LÊ a config (`logic.if`, `logic.choice_menu`,
 * `logic.fork`) e estoura com config vazia — o try/catch é a mesma tolerância
 * que `ConstrutorComIa` e `FlowCanvas` já praticam ao desenhar um nó.
 */
function ramosDe(def: FlowNodeDefinition<never>, config: unknown): FlowBranch[] {
  try {
    return def.branches(config as never) ?? [];
  } catch {
    return [];
  }
}

/**
 * As saídas ditas ao modelo — e o `kind` de cada uma, que não é enfeite.
 *
 * Sem isto o modelo liga arestas sem saber que "Mandar mensagem para o cliente"
 * tem TRÊS saídas, nem que duas delas são exceção e podem ficar soltas. A
 * publicação cobra ligação em saída de REGRA e libera a de exceção
 * (`validate-publish.ts`); um modelo que não sabe a diferença ou deixa regra
 * solta — e aí não publica — ou gasta blocos tratando erro que ninguém pediu.
 */
function saidasComoTexto(def: FlowNodeDefinition<never>): string {
  const ramos = ramosDe(def, configExemploDoTipo(def.type));
  if (ramos.length === 0) return "Saídas: nenhuma (é fim de linha).";
  const partes = ramos.map((r) => {
    const nota =
      r.kind === "excecao"
        ? " [exceção — pode ficar solta]"
        : r.kind === "fallback"
          ? " [pega-tudo — pode ficar solta]"
          : "";
    return `"${r.label}"${nota}`;
  });
  return `Saídas: ${partes.join(", ")}.`;
}

function manualDosBlocos(): string {
  garantirNosRegistrados();
  return todosOsNos()
    .map((def) => {
      const exemplo = JSON.stringify(configExemploDoTipo(def.type));
      return (
        `- ${def.type} ("${def.rotulo}"): ${def.descricao}\n` +
        `  ${saidasComoTexto(def)}\n` +
        `  Exemplo de config: ${exemplo}`
      );
    })
    .join("\n");
}

/** Os gatilhos que EXISTEM. Derivado — ver o cabeçalho deste arquivo. */
function gatilhosDisponiveis(): string {
  garantirNosRegistrados();
  return todosOsNos()
    .filter((def) => def.category === "trigger")
    .map((def) => `  - ${def.type}: ${def.descricao}`)
    .join("\n");
}

/**
 * Os tipos cujas saídas SAEM DA CONFIG — e por isso só existem depois da etapa 2.
 *
 * Detectado, não digitado: se `branches()` com o exemplo devolve saídas
 * diferentes das que devolve com config vazia, aquele tipo tem ramo dinâmico. A
 * regra do `ramo` da ligação vale para todos eles, e citava só um.
 */
export function tiposDeRamoDinamico(): string[] {
  garantirNosRegistrados();
  return todosOsNos()
    .filter((def) => {
      const comExemplo = ramosDe(def, configExemploDoTipo(def.type));
      const semConfig = ramosDe(def, {});
      if (comExemplo.length !== semConfig.length) return true;
      return comExemplo.some((r, i) => r.id !== semConfig[i]?.id);
    })
    .map((def) => def.type);
}

/**
 * Os tipos que nascem apontando para um recurso que a instalação talvez não tenha.
 *
 * O UUID nulo no exemplo é deliberado (`node-examples.ts`): um valor de queda
 * que NÃO pode acertar um fluxo, uma conexão ou uma pessoa real por acidente. O
 * efeito colateral é que o bloco chega ao quadro parecendo pronto e **não
 * publica** — e o modelo não tinha como saber disso.
 */
export function tiposComRecursoExterno(): string[] {
  garantirNosRegistrados();
  return todosOsNos()
    .filter((def) => JSON.stringify(configExemploDoTipo(def.type)).includes(UUID_NULO))
    .map((def) => def.type);
}

/** As regras que a PUBLICAÇÃO cobra, ditas antes de o fluxo ser montado. */
function regrasDePublicacao(): string {
  const dinamicos = tiposDeRamoDinamico();
  const externos = tiposComRecursoExterno();
  return `- O primeiro bloco é sempre um gatilho, e o fluxo tem UM só. Os gatilhos são:
${gatilhosDisponiveis()}
  Escolha o que corresponde ao que a pessoa descreveu — não use o de lead novo
  quando ela falou de mensagem que chega, de palavra escrita, ou de um sistema
  de fora chamando.
- Toda saída de REGRA precisa de uma ligação saindo dela. As marcadas
  [exceção] e [pega-tudo] no manual podem ficar soltas: o motor encerra aquela
  frente sozinho. Não gaste blocos tratando erro que ninguém pediu.
- Nada volta para o bloco de início.
- Nenhum círculo de ligações. Para repetir, use o bloco de laço, que tem contador.
- Bifurcar e reencontrar andam em PAR: sempre que usar o bloco que faz ao mesmo
  tempo, planeje o de reencontro junto, e diga na intenção do primeiro em qual
  id ele reencontra. Bifurcação sem reencontro não publica.
- Estes blocos têm as saídas definidas nos campos, que só são preenchidos
  depois: ${dinamicos.join(", ")}. Declare cada saída na INTENÇÃO do bloco e
  use o mesmo texto no campo "ramo" da ligação.
- Estes precisam do id de um recurso que já existe (um fluxo, uma conexão, uma
  pessoa): ${externos.join(", ")}. Use um deles só se a pessoa nomeou o
  recurso; se não nomeou, escolha outro caminho, ou diga na intenção que falta
  escolher — do contrário o fluxo chega pronto na tela e não publica.`;
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

Se faltar algo, faça UMA pergunta objetiva. Ela pode ser de dois jeitos:

- COM OPÇÕES (2 a 5), quando as respostas possíveis são poucas e conhecidas.
- ABERTA — "resposta_livre": true e "opcoes" vazio — quando o valor não cabe
  numa lista: o texto exato de uma mensagem, o nome de uma etiqueta, um
  telefone. Oferecer três opções inventadas para isso obriga a pessoa a
  escolher entre coisas que não são as dela.

Prefira perguntar a assumir um valor que muda o comportamento do fluxo — mas
não pergunte o que já pode ser um padrão razoável (ex.: não pergunte
"5 minutos ou 10 minutos de espera" se a pessoa não deu nenhum indício de que o
tempo importa; escolha um padrão sensato e diga isso no resumo).

Se você já tem o suficiente, devolva um resumo curto do plano (1-2 frases,
em português, para a pessoa confirmar que entendeu o que vai ser montado).`;
}

/**
 * System prompt da ETAPA 1 da geração nova: o plano, sem nenhuma config.
 *
 * A diferença para o pedido antigo — o grafo inteiro numa resposta — não é de
 * estilo. Ali o modelo tinha de escolher, para cada bloco, uma variante entre
 * dezenas de formas E preencher os campos daquela forma, tudo numa resposta.
 * Aqui ele só decide QUAIS blocos, em que ordem e ligados como — e o "manual"
 * continua entrando porque escolher o tipo certo exige saber o que cada tipo faz.
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

Regras do plano — um fluxo que quebre qualquer uma delas NÃO PUBLICA:
${regrasDePublicacao()}
- Todo bloco que não é fim de linha tem pelo menos uma ligação saindo dele.
- Marque o fim de cada caminho com o bloco de fim.
- IDs de bloco são curtos e você mesmo escolhe (ex.: "n1", "checa_score").
- Prefira o fluxo mais simples que atenda ao pedido: menos blocos, menos ramos.

Monte o plano que a pessoa pediu, usando o histórico da conversa (incluindo as
respostas que ela já deu às suas perguntas).`;
}

/**
 * System prompt da correção: o mesmo plano, com os erros da publicação na mão.
 *
 * ═══ Por que uma correção barata vale mais que um modelo caro ═══
 *
 * A régua que reprova o fluxo é `validarParaPublicar`, e ela nunca rodava no
 * caminho da IA: `plan-to-graph.ts` conferia só a FORMA (`flowGraphSchema`).
 * O modelo entregava, a tela desenhava, e o erro só aparecia quando a pessoa
 * clicava em Publicar — em vocabulário de motor, sobre um fluxo que ela não
 * escreveu. Dizer ao modelo o que ele quebrou é a informação que faltava, e
 * ela custa UMA chamada curta, só quando houve erro.
 */
export function promptDeCorrecao(erros: readonly string[]): string {
  return `Você corrige um plano de fluxo de CRM que não passou na validação.

Os tipos de bloco disponíveis são exatamente estes:
${manualDosBlocos()}

Regras que o plano precisa respeitar:
${regrasDePublicacao()}

Estes problemas foram encontrados no plano que você recebe a seguir:
${erros.map((e) => `- ${e}`).join("\n")}

Devolva o plano INTEIRO corrigido, no mesmo formato. Mexa só no necessário
para resolver os problemas listados: mantenha os ids, os rótulos e as intenções
dos blocos que não têm problema. Não acrescente blocos que ninguém pediu.`;
}

/**
 * System prompt do AJUSTE: mexer num fluxo que já existe.
 *
 * ═══ A instrução que faz o ajuste não ser uma reescrita ═══
 *
 * O pedido é uma alteração ("a espera passa a ser de uma hora"), e a tentação do
 * modelo é devolver um fluxo "melhorado" inteiro. Isso apagaria tudo que a
 * pessoa ajustou à mão: quem decide preservar é `dividirOAjuste`, comparando as
 * INTENÇÕES, e ela só consegue preservar o que voltar com a intenção intacta.
 * Por isso a regra de não mexer no que não foi pedido está escrita em maiúsculo
 * aqui — ela é a diferença entre um ajuste e uma substituição.
 */
export function promptDeAjuste(): string {
  return `Você ajusta um fluxo de automação de CRM que JÁ EXISTE.

Os tipos de bloco disponíveis são exatamente estes:
${manualDosBlocos()}

Regras que o fluxo precisa respeitar:
${regrasDePublicacao()}

⚠️ MEXA SÓ NO QUE FOI PEDIDO. Você recebe o fluxo atual e um pedido de
alteração. Devolva o fluxo INTEIRO com a alteração aplicada, e:

- Todo bloco que a alteração não toca volta com o MESMO id, o MESMO rótulo e a
  MESMA intenção, letra por letra. Reescrever a intenção de um bloco intocado
  faz o sistema recriar os campos dele e apagar o que a pessoa ajustou à mão.
- Bloco novo ganha um id novo, curto.
- Remover um bloco é remover ele e as ligações dele.
- Não "melhore" o fluxo por conta própria: se o pedido é trocar um tempo de
  espera, só o tempo de espera muda.`;
}

/** O plano que falhou, em texto, para acompanhar `promptDeCorrecao`. */
export function planoComoTexto(plano: {
  blocos: readonly { id: string; tipo: string; rotulo: string; intencao: string }[];
  ligacoes: readonly { de: string; para: string; ramo?: string }[];
}): string {
  const blocos = plano.blocos
    .map((b) => `- ${b.id} (${b.tipo}) "${b.rotulo}": ${b.intencao}`)
    .join("\n");
  const ligacoes = plano.ligacoes
    .map((l) => `- ${l.de} -> ${l.para}${l.ramo ? ` pela saída "${l.ramo}"` : ""}`)
    .join("\n");
  return `Blocos:\n${blocos}\n\nLigações:\n${ligacoes || "(nenhuma)"}`;
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
  const raizes = Object.entries(RAIZES_DE_VARIAVEL)
    .map(([raiz, oQueE]) => `  - {{${raiz}.…}} — ${oQueE}`)
    .join("\n");
  return `Você preenche os campos de UM bloco de um fluxo de automação de CRM.

O bloco é do tipo "${tipo}" ("${rotulo}"): ${descricao}
Exemplo de preenchimento válido: ${JSON.stringify(configExemploDoTipo(tipo))}

Regras:
- Responda SOMENTE os campos deste bloco. Não invente campo que não existe.
- Use os valores que a intenção do bloco descreve. Onde a intenção não disser,
  escolha um padrão sensato e comum para um CRM.
- Em textos e em condições você pode usar estas raízes de variável, e só elas:
${raizes}
  Ex.: "{{lead.title}}", "{{contact.name}}", "{{vars.dono_escolhido}}".
- Em condições, os operadores possíveis são: ${OPERADORES.join(", ")}.`;
}

/**
 * O pedido da etapa 2: o bloco, a intenção dele, e o fluxo em volta em uma linha.
 *
 * ═══ ⚠️ `ramos` NÃO É ENFEITE — ele conserta um defeito medido ═══
 *
 * O rótulo de uma saída de `logic.if` era inventado DUAS VEZES, em chamadas
 * diferentes: a etapa 1 escrevia o `ramo` de cada ligação, e a etapa 2 escrevia
 * o `saidas[].label` do config, sem saber o que a etapa 1 tinha escrito. Medido
 * contra o provedor real, no mesmo fluxo:
 *
 *     plano  (etapa 1) → ramo "Ainda não respondeu" / "Já respondeu"
 *     config (etapa 2) → label "Sem resposta"        / "Já respondido"
 *
 * Nenhum dos dois pares casa. `resolverRamo` (plan-to-graph.ts) então caía no
 * desempate por ORDEM — que acertou por sorte, porque as ligações saíram na
 * mesma ordem das saídas. Quando não saírem, a aresta vai para o ramo errado em
 * SILÊNCIO: o grafo desenha bonito, `analisarGrafo` não reclama, e o primeiro
 * lead segue pelo caminho errado.
 *
 * Passando os rótulos que o plano já decidiu, o casamento por rótulo acerta por
 * construção e o desempate por ordem volta a ser o que deveria ser: uma rede,
 * não o caminho normal. A rede continua lá — nada foi removido de lá.
 */
export function promptDoBloco(args: {
  pedido: string;
  rotulo: string;
  intencao: string;
  vizinhos: string;
  /** Os `ramo` que o plano declarou saindo deste bloco, na ordem das ligações. */
  ramos?: readonly string[];
}): string {
  const ramos = args.ramos ?? [];
  const exigenciaDeRamos =
    ramos.length > 0
      ? `

As saídas deste bloco DEVEM se chamar exatamente assim, nesta ordem: ` +
        `${ramos.map((r) => `"${r}"`).join(", ")}. ` +
        `Use esses textos, letra por letra, no campo "label" de cada saída — ` +
        `o resto do fluxo já está ligado por esses nomes.`
      : "";

  return `Pedido original da pessoa: ${args.pedido}

Bloco a preencher: "${args.rotulo}"
O que ele faz neste fluxo: ${args.intencao}
Onde ele fica: ${args.vizinhos}${exigenciaDeRamos}`;
}

export function promptDoUsuario(pedido: string, historico: readonly Mensagem[]): string {
  return `Pedido original: ${pedido}\n\nConversa até agora:\n${historicoComoTexto(historico)}`;
}

export type { Mensagem };
