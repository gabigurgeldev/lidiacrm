"use client";

/**
 * Os primitivos que todo formulário de bloco usa.
 *
 * Vieram do fim de `PainelDoNo.tsx`, onde nasceram como três funções privadas
 * de um arquivo de 759 linhas. Mudaram de casa quando o painel virou um arquivo
 * por bloco: dezesseis formulários importando de um deles seria dependência ao
 * contrário — o mais específico servindo o geral.
 *
 * ## Por que `Secao` embrulha `.ios-grupo` e `Campo` NÃO é `.ios-linha`
 *
 * `.ios-linha` é `display:flex; align-items:center` — rótulo e controle lado a
 * lado. Serve para a linha de Ajustes do iOS (nome à esquerda, interruptor à
 * direita) e atrapalha num formulário: espreme o campo de texto na metade
 * direita justamente onde a pessoa vai escrever a mensagem que o cliente lê.
 *
 * Então `Campo` é um bloco com rótulo em cima e controle de largura inteira, e
 * quem dá o visual agrupado é o `.ios-grupo` do `Secao` em volta — o divisor
 * entre irmãos (`.ios-grupo > * + *`) desenha a separação sozinho. O resultado
 * é a mesma leitura ("um cartão, várias linhas") sem apertar o campo.
 *
 * ## Quantos `.ios-grupo` por tela
 *
 * `app/globals.css` avisa que `.ios-grupo` "existe uma vez por tela". A regra
 * que ele protege é a do VIDRO (`backdrop-filter` multiplicado por linha), e
 * `.ios-grupo` não tem vidro nenhum — quem tem é `.ios-vidro`. O consumidor
 * vivo mais antigo, `components/connections/CanalContaClient.tsx`, já usa dois
 * na mesma tela, um por seção de propósito distinto.
 *
 * Aqui vale a mesma leitura: um punhado de seções propositais por formulário
 * (raramente mais de duas), NUNCA uma por item de lista repetida — e nenhuma no
 * cartão do bloco no quadro, que se repete por nó e é onde a regra morde.
 */

/** O que todo formulário de bloco recebe. Extras são opcionais e por bloco. */
export interface PropsDoFormulario {
  config: Record<string, unknown>;
  aoMudarConfig: (config: Record<string, unknown>) => void;
  /** Blocos de reencontro do MESMO fluxo — só `logic.fork` usa. */
  blocosDeReencontro?: readonly BlocoAlcancavel[];
  /** Fluxos publicados da organização — só `flow.call` usa. */
  fluxosChamaveis?: readonly FluxoChamavel[];
}

/** Um bloco do MESMO fluxo, oferecido como alvo de reencontro. */
export interface BlocoAlcancavel {
  id: string;
  rotulo: string;
}

/** Um fluxo da organização, oferecido para "chamar outro fluxo". */
export interface FluxoChamavel {
  id: string;
  nome: string;
  publicado: boolean;
}

// `Secao`, `Campo`, `Dica` e `Aviso` subiram para o kit de Ajustes
// (`components/ajustes`), que as outras telas também usam. Reexportados aqui
// para os dezesseis formulários de bloco não mudarem de import.
export { Aviso, Campo, Dica, Secao } from "@/components/ajustes";
