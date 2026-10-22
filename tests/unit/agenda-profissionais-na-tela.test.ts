import { describe, expect, it } from "vitest";

import {
  filtrarPorEscolha,
  horariosPorDiaComQuem,
  idsParaMarcar,
  responsavelDaGrade,
} from "@/components/agenda/profissionais-na-tela";
import type { Agendamento, Pessoa } from "@/components/agenda/tipos";
import { paraAGrade } from "@/hooks/agenda/useAgendamentos";

/**
 * PROFISSIONAIS NA TELA (0245) — o que a grade e o painel fazem com o que a API
 * diz sobre QUEM atende.
 *
 * O modo de falha que estes casos vigiam é MUDO: id de membro onde a grade
 * espera id de profissional pinta o bloco na trilha 1 e o tira do filtro, sem
 * erro nenhum; um horário que mostra "Ana" e marca com a Bia é uma promessa
 * quebrada que só aparece quando a cliente chega.
 */

const ANA: Pessoa = { id: "p-ana", nome: "Ana", trilha: 3, userId: "u-ana" };
const BIA: Pessoa = { id: "p-bia", nome: "Bia", trilha: 5, userId: null };
const NOMES = new Map([
  [ANA.id, ANA.nome],
  [BIA.id, BIA.nome],
]);

function ag(parcial: Partial<Agendamento>): Agendamento {
  return {
    id: "a-1",
    titulo: "Consulta",
    responsavelId: ANA.id,
    comeca: "2026-10-22T13:00:00.000Z",
    termina: "2026-10-22T14:00:00.000Z",
    origem: "ui",
    situacao: "confirmed",
    ...parcial,
  };
}

describe("responsavelDaGrade — o membro vira a profissional dele", () => {
  it("ocupação do Google (chega com o user_id da conexão) cai na coluna e na cor da Ana", () => {
    const [google] = responsavelDaGrade([ag({ responsavelId: "u-ana", origem: "google_sync" })], [ANA, BIA]);
    expect(google?.responsavelId, "sem a tradução o bloco não acha pessoa e cai na trilha 1").toBe(ANA.id);
  });

  it("id que já é de profissional passa intacto — inclusive o da apoio", () => {
    const original = ag({ responsavelId: BIA.id, apoioId: ANA.id });
    const [mesmo] = responsavelDaGrade([original], [ANA, BIA]);
    expect(mesmo, "nada a traduzir: o objeto é o mesmo, sem cópia").toBe(original);
  });

  it("a apoio que chega como membro também é traduzida", () => {
    const [a] = responsavelDaGrade([ag({ responsavelId: BIA.id, apoioId: "u-ana" })], [ANA, BIA]);
    expect(a?.apoioId).toBe(ANA.id);
  });

  it("id que não casa com ninguém fica como está — melhor sem cor que na pessoa errada", () => {
    const [a] = responsavelDaGrade([ag({ responsavelId: "u-desconhecido" })], [ANA, BIA]);
    expect(a?.responsavelId).toBe("u-desconhecido");
  });
});

describe("horariosPorDiaComQuem — cada horário diz quem atende", () => {
  const formatar = { dia: (d: Date) => d.toISOString().slice(0, 10), hora: (d: Date) => d.toISOString().slice(11, 16) };

  it("a PRIMEIRA opção é a mostrada, e as outras viram contagem", () => {
    const mapa = horariosPorDiaComQuem(
      [
        {
          inicio: "2026-10-22T13:00:00.000Z",
          opcoes: [
            { principal_id: ANA.id, apoio_id: BIA.id },
            { principal_id: BIA.id, apoio_id: ANA.id },
          ],
        },
      ],
      NOMES,
      formatar,
    );
    const [h] = mapa["2026-10-22"] ?? [];
    expect(h?.quem).toBe("Ana + Bia");
    expect(h?.opcao).toEqual({ principalId: ANA.id, apoioId: BIA.id });
    expect(h?.alternativas).toBe(1);
  });

  it("servidor anterior à 0245 (sem `opcoes`): o horário aparece, sem linha de quem", () => {
    const mapa = horariosPorDiaComQuem([{ inicio: "2026-10-22T13:00:00.000Z" }], NOMES, formatar);
    const [h] = mapa["2026-10-22"] ?? [];
    expect(h?.rotulo).toBe("13:00");
    expect(h).not.toHaveProperty("quem");
    expect(h).not.toHaveProperty("opcao");
  });
});

describe("filtrarPorEscolha — a escolha parcial funciona", () => {
  const slots = [
    {
      inicio: "2026-10-22T13:00:00.000Z",
      opcoes: [
        { principal_id: ANA.id, apoio_id: BIA.id },
        { principal_id: BIA.id, apoio_id: ANA.id },
      ],
    },
    { inicio: "2026-10-22T14:00:00.000Z", opcoes: [{ principal_id: BIA.id, apoio_id: ANA.id }] },
  ];

  it("'a Ana, com qualquer apoio': só as opções em que ela é a principal, e o horário sem nenhuma SAI", () => {
    const filtrados = filtrarPorEscolha(slots, { principalId: ANA.id, apoioId: null });
    expect(filtrados.map((s) => s.inicio)).toEqual(["2026-10-22T13:00:00.000Z"]);
    expect(filtrados[0]?.opcoes).toEqual([{ principal_id: ANA.id, apoio_id: BIA.id }]);
  });

  it("'qualquer habilitada' nas duas posições não filtra nada", () => {
    expect(filtrarPorEscolha(slots, { principalId: null, apoioId: null })).toEqual(slots);
  });

  it("slot sem `opcoes` (servidor velho) não some da agenda", () => {
    const semOpcoes: Array<{ inicio: string; opcoes?: Array<{ principal_id: string; apoio_id: string | null }> }> = [
      { inicio: "x" },
    ];
    expect(filtrarPorEscolha(semOpcoes, { principalId: ANA.id, apoioId: null })).toHaveLength(1);
  });
});

describe("idsParaMarcar — o que se viu é o que se marca", () => {
  it("a opção mostrada no horário vence", () => {
    expect(
      idsParaMarcar({ principalId: null, apoioId: null }, { opcao: { principalId: BIA.id, apoioId: ANA.id } }),
    ).toEqual([BIA.id, ANA.id]);
  });

  it("sem opção, a escolha explícita; sem nenhuma, a rota decide", () => {
    expect(idsParaMarcar({ principalId: ANA.id, apoioId: null }, {})).toEqual([ANA.id]);
    expect(idsParaMarcar({ principalId: null, apoioId: null }, {})).toBeUndefined();
  });
});

describe("paraAGrade — o item da rota com profissionais", () => {
  const base = {
    id: "a-1",
    titulo: "Consulta",
    iniciaEm: "2026-10-22T13:00:00.000Z",
    terminaEm: "2026-10-22T14:00:00.000Z",
    fuso: "America/Sao_Paulo",
    situacao: "confirmed",
    donoId: "u-ana",
    contatoId: "c-1",
    contatoNome: "Maria",
  };

  it("a principal é a responsável; a apoio, o apoio; a origem é a de verdade", () => {
    const a = paraAGrade({
      ...base,
      profissionais: [
        { id: BIA.id, papel: "apoio" },
        { id: ANA.id, papel: "principal" },
      ],
      eventTypeId: "t-1",
      origem: "mcp",
      autor: "ai",
      conversaId: "conv-1",
    });
    expect(a.responsavelId).toBe(ANA.id);
    expect(a.apoioId).toBe(BIA.id);
    expect(a.origem, "era 'ui' fixo — o selo da IA não tinha como existir").toBe("mcp");
    expect(a.conversaId).toBe("conv-1");
  });

  it("servidor anterior à 0245: cai no dono e na origem 'ui', como antes", () => {
    const a = paraAGrade(base);
    expect(a.responsavelId).toBe("u-ana");
    expect(a.origem).toBe("ui");
    expect(a).not.toHaveProperty("apoioId");
  });

  it("origem fora do vocabulário não vira selo inventado", () => {
    expect(paraAGrade({ ...base, origem: "inventada" as never }).origem).toBe("ui");
  });
});
