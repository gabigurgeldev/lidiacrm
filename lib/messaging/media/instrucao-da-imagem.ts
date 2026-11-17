/**
 * O pedido feito ao modelo de visão para descrever a imagem que o cliente mandou.
 *
 * O texto que sai daqui vira `messages.media_derived_text` e é o que o agente lê
 * da foto em todo turno — a imagem crua só chega ao modelo do agente quando ela
 * é a última mensagem (`lib/agent-engine/agent/media-parts.ts`). Ou seja: o que
 * esta descrição não disser, o agente não sabe.
 *
 * A versão anterior pedia "1-2 frases para um atendente de vendas entender o que
 * o cliente enviou", e saía "a cliente está num banheiro, com o cabelo molhado".
 * Num salão de tranças (Meu Trançado, 2026-11-03) o agente precisava do
 * comprimento do cabelo para saber se o modelo é viável, e a descrição nunca o
 * trazia — a cliente mandava a foto e o agente pedia a mesma foto de novo.
 *
 * Por isso o pedido agora nomeia o que muda um orçamento — tamanho estimado por
 * uma referência visível, cor, quantidade, estado, texto legível — sem citar
 * nicho nenhum: a mesma régua serve a móvel, roupa, peça de carro ou cabelo. O
 * exemplo do cabelo fica como exemplo de referência no corpo, não como regra.
 */
export const INSTRUCAO_DE_DESCRICAO_DA_IMAGEM =
  "Descreva esta imagem em português, em até 4 frases curtas, para um atendente de vendas entender o que o " +
  "cliente enviou e conseguir passar um orçamento. Diga primeiro o que ela é: foto de pessoa, de produto, de " +
  "documento ou comprovante, print de tela ou quadro de vídeo. Depois traga os detalhes visíveis que mudam um " +
  "orçamento, quando aparecerem: tamanho ou comprimento estimado usando uma referência que dá para ver (por " +
  "exemplo, até onde o cabelo chega no corpo: orelha, queixo, ombro, meio das costas, cintura; ou o tamanho de " +
  "um objeto comparado a algo conhecido), cores, quantidade, tipo ou textura, estado de conservação e textos " +
  "legíveis como marca, modelo, medidas e valores. Não invente o que não dá para ver; se a imagem estiver " +
  "escura, cortada ou borrada, diga isso.";
