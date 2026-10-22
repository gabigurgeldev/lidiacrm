/**
 * O TEXTO DO LEMBRETE (`lib/agenda/lembrete/texto.ts`).
 *
 * Data e hora ABSOLUTAS, no fuso DO AGENDAMENTO: o texto é escrito agora e lido
 * depois (a fila pode segurá-lo até a janela do número abrir), e o servidor roda
 * em UTC.
 */
import { describe, expect, it } from "vitest";

import { dataPorExtenso, horaNoFuso, textoDoLembrete } from "@/lib/agenda/lembrete/texto";

const AGORA = new Date("2026-10-22T12:00:00Z");
// Sexta, 23/10/2026, 14:30 em São Paulo (UTC-3) = 17:30Z.
const CONSULTA = new Date("2026-10-23T17:30:00Z");

describe("data e hora", () => {
  it("a hora sai no fuso do agendamento, não no do servidor", () => {
    expect(horaNoFuso(CONSULTA, "America/Sao_Paulo")).toBe("14:30");
    // CONTROLE: o mesmo instante em outro fuso dá outra hora — o fuso é lido.
    expect(horaNoFuso(CONSULTA, "Europe/Lisbon")).toBe("18:30");
  });

  it("dia da semana + dia + mês, sem o ano quando é o ano corrente", () => {
    expect(dataPorExtenso(CONSULTA, "America/Sao_Paulo", AGORA)).toBe("sexta-feira, 23 de outubro");
  });

  it("o ano aparece quando muda", () => {
    const ano = dataPorExtenso(new Date("2027-01-05T15:00:00Z"), "America/Sao_Paulo", AGORA);
    expect(ano).toMatch(/2027/);
  });

  it("fuso inválido cai no padrão do produto, não lança", () => {
    expect(horaNoFuso(CONSULTA, "Nao/Existe")).toBe("14:30");
  });
});

describe("a mensagem", () => {
  it("nome, serviço, data, hora e quem atende", () => {
    const t = textoDoLembrete({
      nomeDoCliente: "MARIA da Silva",
      servico: "Limpeza de pele",
      iniciaEm: CONSULTA,
      fuso: "America/Sao_Paulo",
      profissionais: ["Ana", "Bia"],
      agora: AGORA,
    });
    expect(t).toBe(
      "Olá, Maria! Passando para lembrar do seu horário: Limpeza de pele na sexta-feira, 23 de outubro, " +
        "às 14:30, com Ana e Bia. Se precisar remarcar, é só responder esta mensagem.",
    );
  });

  it("nunca diz 'amanhã' nem 'hoje' — o texto é lido depois de escrito", () => {
    const t = textoDoLembrete({
      nomeDoCliente: null,
      servico: "Consulta",
      iniciaEm: CONSULTA,
      fuso: "America/Sao_Paulo",
      profissionais: [],
      agora: AGORA,
    });
    expect(t).not.toMatch(/amanhã|hoje/i);
    expect(t.startsWith("Olá! ")).toBe(true);
    expect(t).not.toMatch(/, com /);
  });

  it("sábado e domingo levam 'no'", () => {
    const t = textoDoLembrete({
      nomeDoCliente: "Ana",
      servico: "Consulta",
      iniciaEm: new Date("2026-10-24T13:00:00Z"),
      fuso: "America/Sao_Paulo",
      profissionais: [],
      agora: AGORA,
    });
    expect(t).toMatch(/Consulta no sábado, 24 de outubro, às 10:00/);
  });

  it("nome que é rótulo de anonimização não vira saudação", () => {
    const t = textoDoLembrete({
      nomeDoCliente: "Cliente Anonimizado #12",
      servico: "Consulta",
      iniciaEm: CONSULTA,
      fuso: "America/Sao_Paulo",
      profissionais: [],
      agora: AGORA,
    });
    // "Cliente" passa como primeiro nome — por isso o motor pula contato
    // anonimizado ANTES de chegar aqui. Este caso documenta o limite.
    expect(t.startsWith("Olá, Cliente!")).toBe(true);
  });
});
