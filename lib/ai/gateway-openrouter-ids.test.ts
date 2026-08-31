/**
 * OS IDS PADRÃO PRECISAM EXISTIR NA OPENROUTER.
 *
 * O defeito que originou este arquivo: `DEFAULT_CLASSIFIER_MODEL` é
 * `anthropic/claude-haiku-4-5`, com HÍFEN, e a OpenRouter nomeia esse modelo
 * `anthropic/claude-haiku-4.5`, com PONTO. O código passava o id canônico sem
 * tradução, apoiado num comentário que afirmava que os dois coincidiam.
 *
 * O modo de falha é o pior tipo: id inexistente na OpenRouter não devolve 401
 * nem erro de rede — devolve algo que não é o objeto pedido, e o SDK relata
 * `No object generated: could not parse the response`. Essa frase não contém o
 * id, não contém o provedor, e não sugere nada. Em produção, criar fluxo com IA
 * falhava sempre, em TODA instalação com `OPENROUTER_API_KEY` — que é o caminho
 * recomendado do self-host.
 *
 * Estes testes são de FORMA, não de rede: o catálogo real muda e um teste que
 * o consultasse ficaria vermelho por motivo alheio ao repositório. Para
 * reconferir contra a fonte:
 *
 *   curl -s https://openrouter.ai/api/v1/models \
 *     | python3 -c "import sys,json;[print(m['id']) for m in json.load(sys.stdin)['data'] if m['id'].startswith('anthropic/')]"
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOT_MODEL,
  DEFAULT_CLASSIFIER_MODEL,
  idNaOpenRouter,
} from "./gateway";

describe("tradução de id para a OpenRouter", () => {
  it("traduz o classificador — hífen aqui, ponto lá", () => {
    expect(idNaOpenRouter("anthropic/claude-haiku-4-5")).toBe("anthropic/claude-haiku-4.5");
  });

  it("NÃO mexe no que já coincide — mapear o igual criaria fonte de verdade para envelhecer", () => {
    // Medidos no catálogo da OpenRouter: existem com exatamente estes nomes.
    expect(idNaOpenRouter("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
    expect(idNaOpenRouter("anthropic/claude-opus-5")).toBe("anthropic/claude-opus-5");
  });

  it("id desconhecido passa inteiro — o mapa corrige, não filtra", () => {
    // Vale para modelo que o cliente digita à mão no painel: a tela aceita
    // texto livre de propósito, e traduzir seria adivinhar.
    expect(idNaOpenRouter("meta-llama/llama-3.3-70b-instruct")).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
  });

  /**
   * A regra que pega o PRÓXIMO caso, e não só este.
   *
   * `claude-haiku-4-5` errou porque a versão do modelo entrou com hífen onde a
   * OpenRouter usa ponto. Todo default novo com dois números no fim corre o
   * mesmo risco, e ninguém vai lembrar deste arquivo ao acrescentá-lo.
   */
  it.each([
    ["DEFAULT_CLASSIFIER_MODEL", DEFAULT_CLASSIFIER_MODEL],
    ["DEFAULT_BOT_MODEL", DEFAULT_BOT_MODEL],
  ])("%s não sai com versão em hífen depois de traduzido", (_nome, id) => {
    const traduzido = idNaOpenRouter(String(id));
    // `-4-5` (versão maior-menor separada por hífen) é a assinatura exata do
    // defeito. `-5` sozinho no fim é legítimo (claude-sonnet-5 existe assim).
    expect(traduzido).not.toMatch(/-\d+-\d+$/);
  });
});
