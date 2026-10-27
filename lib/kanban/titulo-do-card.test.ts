import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { tituloDoCard } from "./card-state";

/**
 * O card de um negócio automático lê o nome VIVO do contato. O título gravado
 * é uma cópia de quando o negócio nasceu, e renomear o contato não chegava ao
 * quadro (relato do dono do produto, 2026-10-27).
 */
describe("tituloDoCard", () => {
  it("negócio que nasceu pelo WhatsApp mostra o nome atual do contato", () => {
    expect(tituloDoCard({ title: "+5594981627533", source: "whatsapp", contact_name: "Carla Oliveira" })).toBe(
      "Carla Oliveira",
    );
    expect(tituloDoCard({ title: "Fernanda", source: "tag", contact_name: "Fernanda Farias" })).toBe(
      "Fernanda Farias",
    );
    expect(tituloDoCard({ title: "Ana", source: "meta_ads", contact_name: "Ana Melo" })).toBe("Ana Melo");
  });

  it("negócio criado à mão mantém o título digitado", () => {
    expect(tituloDoCard({ title: "Pedido #123", source: "manual", contact_name: "Maria Souza" })).toBe(
      "Pedido #123",
    );
  });

  it("sem contato com nome, ou sem origem conhecida, fica o título", () => {
    expect(tituloDoCard({ title: "Lead do site", source: "whatsapp", contact_name: null })).toBe("Lead do site");
    expect(tituloDoCard({ title: "Lead do site", source: "whatsapp", contact_name: "  " })).toBe("Lead do site");
    expect(tituloDoCard({ title: "Lead antigo", contact_name: "Outro" })).toBe("Lead antigo");
  });
});

describe("o card não encolhe na coluna de altura presa", () => {
  it("a raiz do card é shrink-0", () => {
    // O quadro fica na altura da janela e a coluna rola por dentro. Card com
    // `overflow-hidden` tem altura mínima 0 num flex-col: sem `shrink-0`, com
    // 30 cards, cada um encolhia até meia linha do nome (medido em produção).
    // O jsdom não faz layout, então a guarda é na classe.
    const fonte = fs.readFileSync(path.join(process.cwd(), "components/kanban/KanbanCard.tsx"), "utf8");
    const raiz = fonte.match(/"group relative[^"]*"/)?.[0] ?? "";
    expect(raiz).toContain("shrink-0");
    expect(raiz).toContain("overflow-hidden");
  });
});
