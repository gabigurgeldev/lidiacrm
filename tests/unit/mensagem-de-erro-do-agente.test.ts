/**
 * O ERRO DO EDITOR DO AGENTE DIZ O QUE FAZER — EM PORTUGUÊS E EM ESPANHOL.
 *
 * O editor mostrava "Falha ao publicar: credential_missing". Agora cada código
 * vira uma frase que diz o que deu errado e onde mexer. Duas coisas a guardar:
 * todo código que a publicação pode devolver tem frase PRÓPRIA (não o genérico),
 * e toda frase tem tradução — quem instala em espanhol leria português cru.
 */
import { describe, expect, it } from "vitest";

import { FRASES_DE_ERRO_DO_AGENTE, mensagemDeErroDoAgente } from "@/lib/ai/agents/mensagem-de-erro";
import { PUBLISH_ERROR_CODES } from "@/lib/ai/agents/validation";
import { DICIONARIO } from "@/lib/i18n/dicionario";

describe("mensagemDeErroDoAgente", () => {
  const generica = mensagemDeErroDoAgente("codigo_que_nao_existe");

  it.each([...PUBLISH_ERROR_CODES])("o código de publicação %s tem frase própria", (codigo) => {
    expect(mensagemDeErroDoAgente(codigo)).not.toBe(generica);
  });

  it("toda frase tem tradução para o espanhol", () => {
    const semTraducao = FRASES_DE_ERRO_DO_AGENTE.filter((f) => !DICIONARIO[f]?.es);
    expect(semTraducao).toEqual([]);
  });
});
