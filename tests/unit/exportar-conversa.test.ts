/**
 * EXPORTAR A CONVERSA (PDF / Excel) — o arquivo diz o que a tela diz.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  fusoSeguro,
  linhasDaConversa,
  nomeDoArquivo,
  textoParaPdf,
  type MensagemParaExportar,
} from "@/lib/conversas/exportar";
import { gerarPdfDaConversa, gerarXlsxDaConversa } from "@/lib/conversas/exportar-arquivos";

const base: Omit<MensagemParaExportar, "id" | "sent_at"> = {
  direction: "inbound",
  type: "text",
  body: "oi",
  sent_via: null,
  sent_by_user_id: null,
  status: "delivered",
  revoked_at: null,
};

const mensagens: MensagemParaExportar[] = [
  // Chegam fora de ordem, como vêm da consulta (mais nova primeiro).
  { ...base, id: "3", sent_at: "2026-09-29T18:25:00Z", direction: "outbound", sent_via: "ai", body: "Perfeito! 😊 já te ajudo", status: "read" },
  { ...base, id: "2", sent_at: "2026-09-29T18:21:00Z", type: "audio", body: null },
  { ...base, id: "1", sent_at: "2026-09-29T18:20:00Z", body: "Boa tarde" },
  { ...base, id: "4", sent_at: "2026-09-29T18:30:00Z", body: "segredo", revoked_at: "2026-09-29T18:31:00Z" },
  { ...base, id: "5", sent_at: "2026-09-29T18:40:00Z", direction: "outbound", sent_by_user_id: "u1", body: "Fechado", status: "sent" },
];

describe("linhasDaConversa", () => {
  const linhas = linhasDaConversa(mensagens, "America/Sao_Paulo", new Map([["u1", "Carla"]]));

  it("⭐ ordem de leitura (mais antiga primeiro) e hora no fuso da empresa", () => {
    expect(linhas.map((l) => l.texto)).toEqual([
      "Boa tarde",
      "[Áudio]",
      "Perfeito! 😊 já te ajudo",
      "(mensagem apagada)",
      "Fechado",
    ]);
    expect(linhas[0]).toMatchObject({ data: "29/09/2026", hora: "15:20", direcao: "Recebida", autor: "Cliente" });
  });

  it("⭐ mensagem apagada NUNCA sai com o texto que o cliente tirou do ar", () => {
    expect(linhas.some((l) => l.texto.includes("segredo"))).toBe(false);
  });

  it("autor: automático, atendente pelo nome, e situação só do que saiu", () => {
    expect(linhas[2]).toMatchObject({ autor: "Automático", situacao: "Lida", direcao: "Enviada" });
    expect(linhas[4]).toMatchObject({ autor: "Carla", situacao: "Enviada" });
    expect(linhas[0]!.situacao).toBe("");
  });
});

describe("apoio", () => {
  it("fuso inválido cai em São Paulo em vez de derrubar a exportação", () => {
    expect(fusoSeguro("Lua/Base")).toBe("America/Sao_Paulo");
    expect(fusoSeguro("America/Manaus")).toBe("America/Manaus");
  });

  it("nome do arquivo sem acento nem espaço", () => {
    expect(nomeDoArquivo("Flor de Juá Moda", new Date("2026-09-29T12:00:00Z"))).toBe(
      "conversa-flor-de-jua-moda-2026-09-29",
    );
  });

  it("PDF: emoji sai, acento fica", () => {
    expect(textoParaPdf("Perfeito! 😊 já te ajudo")).toBe("Perfeito!  já te ajudo");
  });
});

describe("arquivos de verdade", () => {
  const linhas = linhasDaConversa(mensagens, "America/Sao_Paulo");
  const cab = {
    contato: "Rafael Castro",
    telefone: "+5594984304355",
    canal: "+559481627533",
    geradoEm: "29/09/2026 15:45",
    total: linhas.length,
    cortado: false,
  };

  it("gera um PDF", async () => {
    const pdf = await gerarPdfDaConversa(cab, linhas);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it("gera um .xlsx que o Excel lê de volta, com o texto COMPLETO (emoji inclusive)", async () => {
    const xlsx = await gerarXlsxDaConversa(cab, linhas);
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(xlsx as unknown as ArrayBuffer);
    const aba = livro.getWorksheet("Conversa")!;
    expect(aba.getRow(1).getCell(6).value).toBe("Mensagem");
    expect(aba.getRow(4).getCell(6).value).toBe("Perfeito! 😊 já te ajudo");
    expect(aba.rowCount).toBe(linhas.length + 1);
  }, 30_000);
});

describe("autor de mensagem sem nome gravado", () => {
  it("saiu da tela do CRM sem autor: 'Atendente', nunca 'Sistema'", () => {
    const [l] = linhasDaConversa(
      [{ ...base, id: "x", sent_at: "2026-09-29T18:00:00Z", direction: "outbound", sent_via: "crm" }],
      "America/Sao_Paulo",
    );
    expect(l!.autor).toBe("Atendente");
  });
});
