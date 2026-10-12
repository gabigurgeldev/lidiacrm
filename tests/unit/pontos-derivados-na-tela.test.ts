/**
 * A TELA DE PROVEDORES DIZ O MODELO QUE O PONTO USA DE VERDADE.
 *
 * "Buscar no seu material" aparecia como Claude — o modelo de conversa padrão
 * — porque a rota passava todo ponto por `decidirBinding`. É um embedding da
 * OpenAI. Quem lia concluía que a busca rodava no Claude e que não havia como
 * mudar. Mesmo defeito em "Ensaiar o agente" e "Medir o tamanho do contexto".
 */
import { describe, expect, it } from "vitest";

import { efetivoDerivado, PONTOS_DERIVADOS, type ContextoDaTela } from "@/lib/ai/pontos/efetivo-na-tela";
import { validarBinding } from "@/lib/ai/pontos/validar-binding";
import { transcricaoDoBinding, TRANSCRICAO_PELA_OPENROUTER } from "@/lib/messaging/media/transcription";

const CTX: ContextoDaTela = {
  chaves: { openai: false, openrouter: true },
  bindingDaTranscricao: null,
  modeloDeEmbedding: "openai/text-embedding-3-small",
  agentePublicado: { provider: "anthropic", model: "claude-sonnet-5" },
};

describe("efetivoDerivado", () => {
  it.each(["embedding_indexar", "embedding_consultar"])("%s mostra o embedding, nunca o modelo de conversa", (id) => {
    const r = efetivoDerivado(id, CTX)!;
    expect(r.efetivo.modelId).toBe("openai/text-embedding-3-small");
    expect(r.efetivo.modelId).not.toMatch(/claude/);
    expect(r.efetivo.provider).toBe("openrouter");
    expect(r.efetivo.porQue).toMatch(/não modelo de conversa/);
  });

  it("embedding sem chave nenhuma avisa que o material não é consultado", () => {
    const r = efetivoDerivado("embedding_consultar", { ...CTX, chaves: { openai: false, openrouter: false } })!;
    expect(r.avisos[0]).toMatch(/não é indexado nem consultado/);
  });

  it("ensaio diz que usa a versão ensaiada, sem inventar um modelo próprio", () => {
    const r = efetivoDerivado("teste_de_agente", CTX)!;
    expect(r.efetivo.modelId).toBeNull();
    expect(r.efetivo.porQue).toMatch(/versão que você ensaia/);
  });

  it("transcrição oferece só OpenAI e OpenRouter, com modelos de áudio", () => {
    const r = efetivoDerivado("transcricao_de_audio", CTX)!;
    expect(r.restricao?.provedores).toEqual(["openai", "openrouter"]);
    expect(r.restricao?.modelos.every((m) => /transcribe|whisper/.test(m.model_id))).toBe(true);
  });

  it("transcrição com escolha no painel mostra a escolha", () => {
    const r = efetivoDerivado("transcricao_de_audio", {
      ...CTX,
      bindingDaTranscricao: { provider: "openrouter", model_id: "openai/gpt-4o-transcribe", base_url: null, credential_id: null },
    })!;
    expect(r.efetivo).toMatchObject({ provider: "openrouter", modelId: "openai/gpt-4o-transcribe", origem: "binding" });
  });

  it("ponto comum devolve null (a rota usa decidirBinding)", () => {
    expect(efetivoDerivado("agent_turn", CTX)).toBeNull();
    expect(PONTOS_DERIVADOS.has("agent_turn")).toBe(false);
  });
});

describe("validarBinding no ponto de áudio", () => {
  const modelo = (model_id: string) => ({ model_id, supports_tools: false, supports_vision: false, conhecido: false });

  it("recusa provedor que não transcreve, dizendo por quê", () => {
    const r = validarBinding({ pontoId: "transcricao_de_audio", provider: "anthropic", modelo: modelo("claude-haiku-4-5") });
    expect(r).toMatchObject({ ok: false, codigo: "provedor_nao_transcreve" });
    expect(!r.ok && r.mensagem).toMatch(/Anthropic não tem API de áudio/);
  });

  it("aceita modelo de transcrição conhecido sem aviso", () => {
    expect(validarBinding({ pontoId: "transcricao_de_audio", provider: "openai", modelo: modelo("gpt-4o-transcribe") })).toEqual({
      ok: true,
      avisos: [],
    });
  });

  it("aceita id fora da lista com aviso (servidor whisper próprio)", () => {
    const r = validarBinding({ pontoId: "transcricao_de_audio", provider: "openai", modelo: modelo("large-v3") });
    expect(r.ok && r.avisos.length).toBe(1);
  });

  it("o ponto de áudio deixou de ser fixo", () => {
    expect(validarBinding({ pontoId: "transcricao_de_audio", provider: "openai", modelo: modelo("whisper-1") }).ok).toBe(true);
  });
});

describe("transcricaoDoBinding", () => {
  it("OpenRouter usa o endereço de áudio da OpenRouter e o modelo escolhido", () => {
    expect(transcricaoDoBinding({ provider: "openrouter", model_id: "openai/whisper-1", base_url: null }, "sk-or")).toEqual({
      origem: "openrouter",
      creds: { apiKey: "sk-or", model: "openai/whisper-1", baseUrl: TRANSCRICAO_PELA_OPENROUTER.baseUrl },
    });
  });

  it("OpenAI com endereço próprio vai para o endereço próprio", () => {
    expect(
      transcricaoDoBinding({ provider: "openai", model_id: "large-v3", base_url: "http://whisper.local" }, "k")?.creds.baseUrl,
    ).toBe("http://whisper.local");
  });

  it("provedor que não fala o formato devolve null (quem chama volta à escada)", () => {
    expect(transcricaoDoBinding({ provider: "anthropic", model_id: "x", base_url: null }, "k")).toBeNull();
  });
});
