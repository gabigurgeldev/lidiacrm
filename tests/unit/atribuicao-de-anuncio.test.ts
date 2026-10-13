import { describe, expect, it, vi } from "vitest";

import { extrairAtribuicaoMeta } from "@/lib/channels/atribuicao-de-anuncio-oficial";
import {
  anuncioPublico,
  estamparAtribuicaoDoContato,
  lerAnuncioPublico,
} from "@/lib/leads/atribuicao-de-anuncio";
import { extrairAtribuicaoWaha } from "@/lib/waha/atribuicao-de-anuncio";

describe("extrairAtribuicaoMeta — referral do webhook oficial", () => {
  it("extrai um referral de anúncio na forma documentada (snake_case)", () => {
    const r = extrairAtribuicaoMeta({
      source_type: "ad",
      source_id: "120210000000000",
      source_url: "https://fb.me/anuncio123",
      headline: "Agende sua consulta",
      body: "Clique e fale com a gente",
      ctwa_clid: "AfE...clid",
    });
    expect(r).toMatchObject({
      plataforma: "meta_ads",
      sourceId: "AfE...clid",
      titulo: "Agende sua consulta",
      corpo: "Clique e fale com a gente",
      sourceUrl: "https://fb.me/anuncio123",
      bruto: expect.objectContaining({ source_type: "ad" }),
    });
  });

  it("aceita camelCase (caso o agregador normalize)", () => {
    const r = extrairAtribuicaoMeta({
      sourceType: "ad",
      ctwaClid: "clid-123",
      sourceUrl: "https://fb.me/x",
    });
    expect(r?.sourceId).toBe("clid-123");
    expect(r?.sourceUrl).toBe("https://fb.me/x");
  });

  it("cai pra source_id quando não há ctwa_clid", () => {
    const r = extrairAtribuicaoMeta({ source_type: "ad", source_id: "abc" });
    expect(r?.sourceId).toBe("abc");
  });

  it("rejeita source_type 'post' — orgânico, não anúncio pago", () => {
    expect(extrairAtribuicaoMeta({ source_type: "post", source_id: "abc" })).toBeNull();
  });

  it("nulo quando não há nenhum campo que identifique o anúncio", () => {
    expect(extrairAtribuicaoMeta({ body: "só um corpo, sem id nem título nem url" })).toBeNull();
  });

  it("nulo pra payload ausente/vazio/tipo errado", () => {
    expect(extrairAtribuicaoMeta(null)).toBeNull();
    expect(extrairAtribuicaoMeta(undefined)).toBeNull();
    expect(extrairAtribuicaoMeta("string crua")).toBeNull();
    expect(extrairAtribuicaoMeta([])).toBeNull();
  });
});

describe("extrairAtribuicaoWaha — externalAdReply do Baileys", () => {
  // Forma REAL, copiada (com valores trocados) de um inbound de produção em
  // 2026-10-13. A chave é `externalAdReply` — o extrator procurava
  // `externalAdReplyInfo` e nunca casou: 70 cliques, zero contatos atribuídos.
  const cliqueReal = {
    extendedTextMessage: {
      text: "Olá! Quero mais informações.",
      contextInfo: {
        conversionSource: "FB_Ads",
        entryPointConversionSource: "ctwa_ad",
        entryPointConversionApp: "instagram",
        externalAdReply: {
          title: "A LOJA MAIS COMPLETA",
          body: "Pronta entrega!",
          mediaType: "VIDEO",
          thumbnailUrl: "https://cdn.exemplo/thumb.jpg",
          mediaUrl: "https://www.facebook.com/reel/111/",
          thumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD",
          sourceType: "ad",
          sourceId: "120252124339240364",
          sourceUrl: "https://www.instagram.com/p/AbC/",
          ctwaClid: "AfhVFGa3tRkZ",
          sourceApp: "instagram",
        },
      },
    },
  };

  it("reconhece o clique na forma real (externalAdReply)", () => {
    const r = extrairAtribuicaoWaha(cliqueReal);
    expect(r).toMatchObject({
      plataforma: "meta_ads",
      sourceId: "AfhVFGa3tRkZ",
      titulo: "A LOJA MAIS COMPLETA",
      corpo: "Pronta entrega!",
      sourceUrl: "https://www.instagram.com/p/AbC/",
    });
    expect(r?.detalhes).toEqual({
      idDoAnuncio: "120252124339240364",
      ctwaClid: "AfhVFGa3tRkZ",
      tipoDaOrigem: "ad",
      appDeOrigem: "instagram",
      tipoDeMidia: "VIDEO",
      urlDaMidia: "https://www.facebook.com/reel/111/",
      urlDaMiniatura: "https://cdn.exemplo/thumb.jpg",
      origemDaConversao: "FB_Ads",
    });
  });

  it("a prova gravada não leva a miniatura em base64, e leva a origem da conversão", () => {
    const r = extrairAtribuicaoWaha(cliqueReal);
    expect(r?.bruto).not.toHaveProperty("thumbnail");
    expect(r?.bruto).toMatchObject({ conversionSource: "FB_Ads", ctwaClid: "AfhVFGa3tRkZ" });
  });

  it("anuncioPublico projeta os campos que saem para o webhook", () => {
    const r = extrairAtribuicaoWaha(cliqueReal);
    expect(anuncioPublico(r!)).toEqual({
      platform: "meta_ads",
      source_type: "ad",
      source_id: "120252124339240364",
      source_url: "https://www.instagram.com/p/AbC/",
      source_app: "instagram",
      title: "A LOJA MAIS COMPLETA",
      description: "Pronta entrega!",
      media_type: "VIDEO",
      media_url: "https://www.facebook.com/reel/111/",
      thumbnail_url: "https://cdn.exemplo/thumb.jpg",
      ctwa_clid: "AfhVFGa3tRkZ",
      conversion_source: "FB_Ads",
    });
  });

  it("clique sem ctwaClid (acontece — medido) cai para o id do anúncio", () => {
    const semClid = structuredClone(cliqueReal);
    delete (semClid.extendedTextMessage.contextInfo.externalAdReply as Record<string, unknown>).ctwaClid;
    const r = extrairAtribuicaoWaha(semClid);
    expect(r?.sourceId).toBe("120252124339240364");
    expect(r?.detalhes?.ctwaClid).toBeNull();
  });

  it("extrai de extendedTextMessage.contextInfo.externalAdReplyInfo (alias antigo)", () => {
    const r = extrairAtribuicaoWaha({
      extendedTextMessage: {
        text: "Olá, vim do anúncio",
        contextInfo: {
          externalAdReplyInfo: {
            title: "Agende sua consulta",
            body: "Clique e fale com a gente",
            sourceId: "ad-999",
            sourceUrl: "https://fb.me/anuncio123",
            ctwaClid: "clid-999",
          },
        },
      },
    });
    expect(r).toMatchObject({
      plataforma: "meta_ads",
      sourceId: "clid-999",
      titulo: "Agende sua consulta",
      corpo: "Clique e fale com a gente",
      sourceUrl: "https://fb.me/anuncio123",
      bruto: expect.objectContaining({ ctwaClid: "clid-999" }),
    });
  });

  it("também procura em imageMessage/videoMessage.contextInfo", () => {
    const r = extrairAtribuicaoWaha({
      imageMessage: {
        contextInfo: { externalAdReplyInfo: { sourceId: "ad-1", title: "X" } },
      },
    });
    expect(r?.sourceId).toBe("ad-1");
  });

  it("nulo quando é uma mensagem comum, sem contextInfo de anúncio", () => {
    expect(extrairAtribuicaoWaha({ conversation: "oi, tudo bem?" })).toBeNull();
    expect(
      extrairAtribuicaoWaha({ extendedTextMessage: { text: "oi", contextInfo: {} } }),
    ).toBeNull();
  });

  it("post ORGÂNICO compartilhado não é anúncio — o mesmo filtro do irmão oficial", () => {
    // Sem este filtro, o primeiro compartilhamento de um post carimba
    // `meta_ads` no contato — e a guarda de primeiro toque torna isso
    // irreversível pelo caminho normal. O extrator da API oficial já filtrava
    // por `source_type`; este não, e a assimetria não tinha razão escrita.
    expect(
      extrairAtribuicaoWaha({
        extendedTextMessage: {
          text: "oi",
          contextInfo: {
            externalAdReplyInfo: { sourceType: "post", title: "Promo", ctwaClid: "x" },
          },
        },
      }),
    ).toBeNull();

    expect(
      extrairAtribuicaoWaha({
        extendedTextMessage: {
          text: "oi",
          contextInfo: {
            externalAdReplyInfo: { sourceType: "ad", title: "Promo", ctwaClid: "x" },
          },
        },
      }),
    ).toMatchObject({ plataforma: "meta_ads", sourceId: "x", titulo: "Promo" });
  });

  it("nulo pra payload ausente/tipo errado", () => {
    expect(extrairAtribuicaoWaha(null)).toBeNull();
    expect(extrairAtribuicaoWaha(undefined)).toBeNull();
    expect(extrairAtribuicaoWaha("string crua")).toBeNull();
  });
});

describe("lerAnuncioPublico", () => {
  it("aceita só as chaves do contrato — chave estranha gravada não vaza", () => {
    expect(
      lerAnuncioPublico({ platform: "meta_ads", title: "T", organization_id: "x", ctwa_clid: "c" }),
    ).toEqual({
      platform: "meta_ads",
      source_type: null,
      source_id: null,
      source_url: null,
      source_app: null,
      title: "T",
      description: null,
      media_type: null,
      media_url: null,
      thumbnail_url: null,
      ctwa_clid: "c",
      conversion_source: null,
    });
  });

  it("nulo para o que não é um anúncio gravado", () => {
    expect(lerAnuncioPublico(undefined)).toBeNull();
    expect(lerAnuncioPublico({})).toBeNull();
    expect(lerAnuncioPublico("ad")).toBeNull();
  });
});

describe("estamparAtribuicaoDoContato", () => {
  it("chama a RPC com plataforma e metadata montados a partir da atribuição", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const admin = { rpc } as never;

    await estamparAtribuicaoDoContato(admin, "contact-1", {
      plataforma: "meta_ads",
      sourceId: "clid-1",
      titulo: "Título",
      corpo: "Corpo",
      sourceUrl: "https://fb.me/x",
      bruto: { fonte: "teste" },
    });

    expect(rpc).toHaveBeenCalledWith(
      "fn_estampar_atribuicao_de_anuncio",
      expect.objectContaining({
        p_contact: "contact-1",
        p_platform: "meta_ads",
        p_metadata: expect.objectContaining({
          ad_platform: "meta_ads",
          ad_source_id: "clid-1",
          ad_title: "Título",
          ad_body: "Corpo",
          ad_source_url: "https://fb.me/x",
          ad_raw: { fonte: "teste" },
        }),
      }),
    );
  });

  it("não lança quando a RPC falha — só registra o erro", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const admin = { rpc } as never;

    await expect(
      estamparAtribuicaoDoContato(admin, "contact-1", {
        plataforma: "meta_ads",
        sourceId: null,
        titulo: null,
        corpo: null,
        sourceUrl: null,
        bruto: {},
      }),
    ).resolves.toBeUndefined();
  });
});
