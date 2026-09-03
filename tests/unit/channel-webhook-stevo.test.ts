/**
 * O PARSER DEFENSIVO DO WEBHOOK — e por que ele é defensivo.
 *
 * ## O que NÃO foi medido
 *
 * O formato deste payload não consta de nenhum dos três specs publicados pelo
 * provedor: eles descrevem o que se ENVIA a ele e o que ele responde, nunca o
 * corpo dos eventos que ele entrega no nosso endereço.
 *
 * Duas saídas eram possíveis: um Zod estrito chutando os nomes dos campos, ou
 * leitura por tentativa sobre nomes plausíveis. A primeira recusa o evento
 * INTEIRO quando o chute erra, e o sintoma é "as mensagens não chegam" sem nada
 * apontando para o parser. A segunda degrada num `ignorado` com motivo, e deixa
 * o corpo cru arquivado para quem for medir.
 *
 * **Estes casos definem o CONTRATO da degradação**, não o formato real. Quando
 * um evento de verdade for capturado, aperte o parser e substitua estes casos
 * pelo payload medido — mas mantenha os de degradação: eles continuam valendo.
 *
 * ## As asserções que carregam o arquivo
 *
 * Duas, e as duas sobre confundir os lados:
 *
 *  - `fromMe` mal lido faz a mensagem do cliente aparecer como nossa (e o agente
 *    responder a si mesmo) ou a nossa aparecer como dele (e a janela de 24h
 *    abrir sozinha, sem o cliente ter escrito).
 *  - carimbo em segundos lido como milissegundos joga a mensagem para 1970; o
 *    contrário, para o ano 50000. Nos dois casos ela some da ordenação da thread.
 */
import { describe, expect, it } from "vitest";

import { lerEventoStevo } from "@/lib/channels/stevo/webhook";

describe("o que é mensagem", () => {
  it("lê remetente, texto e carimbo de um payload plano", () => {
    const e = lerEventoStevo({
      event: "MESSAGE",
      from: "5531999998888",
      text: "oi",
      id: "ABC",
      timestamp: 1_767_225_600,
    });
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    expect(e.telefone).toBe("5531999998888");
    expect(e.texto).toBe("oi");
    expect(e.externalId).toBe("ABC");
    expect(e.daEmpresa).toBe(false);
  });

  it("acha os campos mesmo ANINHADOS — o nome do nível não é documentado", () => {
    const e = lerEventoStevo({
      event: "MESSAGE",
      data: { message: { from: "5531999998888@c.us", body: "oi de dentro" } },
    });
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    // O sufixo do endereço sai: `5531999998888@c.us` é o mesmo número.
    expect(e.telefone).toBe("5531999998888");
    expect(e.texto).toBe("oi de dentro");
  });

  it("⭐ distingue o que SAIU do celular do operador", () => {
    // Marcar errado faz o agente responder à própria empresa, e a janela de 24h
    // abrir sem o cliente ter escrito.
    const doCelular = lerEventoStevo({
      event: "SEND_MESSAGE",
      from: "5531999998888",
      text: "já te respondo",
    });
    expect(doCelular.tipo).toBe("mensagem");
    if (doCelular.tipo !== "mensagem") return;
    expect(doCelular.daEmpresa).toBe(true);

    const porFlag = lerEventoStevo({ event: "MESSAGE", fromMe: true, from: "5531999998888", text: "x" });
    expect(porFlag.tipo === "mensagem" && porFlag.daEmpresa).toBe(true);
  });

  it("⭐ carimbo em segundos e em milissegundos caem no MESMO instante", () => {
    const seg = lerEventoStevo({ from: "5531999998888", text: "a", timestamp: 1_767_225_600 });
    const ms = lerEventoStevo({ from: "5531999998888", text: "a", timestamp: 1_767_225_600_000 });
    expect(seg.tipo === "mensagem" && ms.tipo === "mensagem").toBe(true);
    if (seg.tipo !== "mensagem" || ms.tipo !== "mensagem") return;
    expect(seg.enviadaEm.getTime()).toBe(ms.enviadaEm.getTime());
    // E o instante é plausível: nem 1970, nem daqui a mil anos.
    expect(seg.enviadaEm.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("mídia sem texto continua sendo mensagem, com o tipo certo", () => {
    const e = lerEventoStevo({
      from: "5531999998888",
      media_url: "https://x/y.ogg",
      type: "ptt",
    });
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    // `ptt` e `voice` são áudio — o vocabulário do WhatsApp, não o nosso.
    expect(e.tipoDeMensagem).toBe("audio");
    expect(e.midiaUrl).toBe("https://x/y.ogg");
  });
});

describe("o que NÃO é mensagem", () => {
  it("evento de conexão é reconhecido, e não vira conversa", () => {
    const e = lerEventoStevo({ event: "CONNECTION", status: "disconnected" });
    expect(e.tipo).toBe("conexao");
  });

  it("⭐ sem remetente reconhecível, IGNORA — não inventa contato sem número", () => {
    // Criar contato "sem número" polui a base de um jeito que ninguém desfaz
    // depois, e a conversa fica sem para quem responder.
    const e = lerEventoStevo({ event: "MESSAGE", text: "oi" });
    expect(e.tipo).toBe("ignorado");
    if (e.tipo !== "ignorado") return;
    expect(e.motivo).toBe("sem_remetente_reconhecivel");
  });

  it("sem conteúdo, ignora — e o motivo diz qual dos dois faltou", () => {
    const e = lerEventoStevo({ event: "MESSAGE", from: "5531999998888" });
    expect(e.tipo === "ignorado" && e.motivo).toBe("sem_conteudo_reconhecivel");
  });

  it("corpo que não é objeto não derruba nada", () => {
    expect(lerEventoStevo("texto solto").tipo).toBe("ignorado");
    expect(lerEventoStevo(null).tipo).toBe("ignorado");
  });

  it("número curto demais não passa por telefone", () => {
    // Um id de 4 dígitos num campo `from` seria um contato com telefone falso —
    // e ele entraria na base como se fosse gente.
    expect(lerEventoStevo({ from: "123", text: "oi" }).tipo).toBe("ignorado");
  });
});

describe("Cloud API oficial — MEDIDO em produção (não é chute)", () => {
  // Achado: uma conta Oficial manda o envelope cru da WhatsApp Cloud API da
  // Meta. O log estruturado mediu `chaves: ["object","entry"]` — o achatador
  // genérico parava aí porque ele não desce em array, e `entry`/`changes`/
  // `messages` são array em TODO nível. Formato abaixo é o documentado
  // publicamente pela Meta (Cloud API webhooks), não um chute.
  function envelope(value: Record<string, unknown>) {
    return {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA_ID", changes: [{ value, field: "messages" }] }],
    };
  }

  it("⭐ lê remetente, texto, id e carimbo de dentro de entry[0].changes[0].value.messages[0]", () => {
    const e = lerEventoStevo(
      envelope({
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "5531999990000", phone_number_id: "123" },
        contacts: [{ profile: { name: "Cliente" }, wa_id: "5531999998888" }],
        messages: [
          {
            from: "5531999998888",
            id: "wamid.HBgLABC",
            timestamp: "1767225600",
            type: "text",
            text: { body: "oi" },
          },
        ],
      }),
    );
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    expect(e.telefone).toBe("5531999998888");
    expect(e.texto).toBe("oi");
    expect(e.externalId).toBe("wamid.HBgLABC");
    expect(e.daEmpresa).toBe(false);
    expect(e.enviadaEm.getTime()).toBe(1_767_225_600 * 1000);
  });

  it("status de entrega (statuses, sem messages) é ignorado com motivo distinto — não é erro", () => {
    const e = lerEventoStevo(
      envelope({
        statuses: [{ id: "wamid.HBgLABC", status: "delivered", timestamp: "1767225600" }],
      }),
    );
    expect(e.tipo).toBe("ignorado");
    if (e.tipo !== "ignorado") return;
    expect(e.motivo).toBe("status_de_entrega");
  });

  it("value sem messages nem statuses vira motivo próprio, não confunde com falta de remetente", () => {
    const e = lerEventoStevo(envelope({}));
    expect(e.tipo === "ignorado" && e.motivo).toBe("cloud_api_sem_mensagem");
  });

  it("Cloud API nunca ecoa o que este CRM mandou — daEmpresa é sempre false aqui", () => {
    const e = lerEventoStevo(
      envelope({
        messages: [{ from: "5531999998888", id: "x", timestamp: "1767225600", type: "text", text: { body: "oi" } }],
      }),
    );
    expect(e.tipo === "mensagem" && e.daEmpresa).toBe(false);
  });
});
