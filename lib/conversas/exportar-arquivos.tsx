/**
 * Os dois arquivos da exportação de conversa: PDF (para ler e mandar) e Excel
 * (para filtrar e contar). Só formatação — o que entra em cada linha é decidido
 * em `./exportar.ts`, uma vez, para os dois.
 *
 * ⚠️ PDF com cor em HEX, nunca `var(--x)` nem `oklch()`: o gerador descarta os
 * dois em silêncio (lição de `lib/lgpd/pdf-renderer.tsx`).
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import ExcelJS from "exceljs";
import React from "react";

import { textoParaPdf, type LinhaExportada } from "./exportar";

export interface CabecalhoDaExportacao {
  contato: string;
  telefone: string | null;
  canal: string | null;
  geradoEm: string;
  total: number;
  cortado: boolean;
}

const estilos = StyleSheet.create({
  pagina: { padding: 32, fontSize: 9.5, fontFamily: "Helvetica", color: "#111b21" },
  titulo: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  meta: { fontSize: 9, color: "#667781", marginBottom: 2 },
  aviso: { fontSize: 9, color: "#b45309", marginTop: 4 },
  divisor: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginVertical: 10 },
  dia: {
    alignSelf: "center",
    fontSize: 8.5,
    color: "#667781",
    backgroundColor: "#f0f2f5",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginVertical: 6,
  },
  linha: { flexDirection: "row", marginBottom: 5 },
  bolha: { maxWidth: "78%", paddingVertical: 4, paddingHorizontal: 7, borderRadius: 6 },
  entrada: { backgroundColor: "#f0f2f5" },
  saida: { backgroundColor: "#d9fdd3", marginLeft: "auto" },
  autor: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#13731b", marginBottom: 1 },
  hora: { fontSize: 7, color: "#667781", marginTop: 2, textAlign: "right" },
  rodape: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 7.5,
    color: "#9ca3af",
    textAlign: "center",
  },
});

function ConversaPdf({ cab, linhas }: { cab: CabecalhoDaExportacao; linhas: LinhaExportada[] }) {
  return (
    <Document title={`Conversa com ${textoParaPdf(cab.contato)}`}>
      <Page size="A4" style={estilos.pagina}>
        <Text style={estilos.titulo}>{`Conversa com ${textoParaPdf(cab.contato)}`}</Text>
        {cab.telefone ? <Text style={estilos.meta}>{`Telefone: ${cab.telefone}`}</Text> : null}
        {cab.canal ? <Text style={estilos.meta}>{`Número da empresa: ${cab.canal}`}</Text> : null}
        <Text style={estilos.meta}>{`${cab.total} mensagens · gerado em ${cab.geradoEm}`}</Text>
        {cab.cortado ? (
          <Text style={estilos.aviso}>
            {`A conversa é maior que o limite do arquivo: aqui estão as ${cab.total} mensagens mais recentes.`}
          </Text>
        ) : null}
        <View style={estilos.divisor} />
        {linhas.map((l, i) => {
          const novoDia = i === 0 || linhas[i - 1]!.data !== l.data;
          const saida = l.direcao === "Enviada";
          return (
            <View key={i} wrap={false}>
              {novoDia ? <Text style={estilos.dia}>{l.data}</Text> : null}
              <View style={estilos.linha}>
                <View style={[estilos.bolha, saida ? estilos.saida : estilos.entrada]}>
                  <Text style={estilos.autor}>{textoParaPdf(l.autor)}</Text>
                  <Text>{textoParaPdf(l.texto) || " "}</Text>
                  <Text style={estilos.hora}>
                    {l.situacao ? `${l.hora} · ${l.situacao}` : l.hora}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
        <Text
          style={estilos.rodape}
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function gerarPdfDaConversa(
  cab: CabecalhoDaExportacao,
  linhas: LinhaExportada[],
): Promise<Buffer> {
  return (await renderToBuffer(<ConversaPdf cab={cab} linhas={linhas} />)) as Buffer;
}

export async function gerarXlsxDaConversa(
  cab: CabecalhoDaExportacao,
  linhas: LinhaExportada[],
): Promise<Buffer> {
  const livro = new ExcelJS.Workbook();
  livro.created = new Date();
  const aba = livro.addWorksheet("Conversa", { views: [{ state: "frozen", ySplit: 1 }] });
  aba.columns = [
    { header: "Data", key: "data", width: 12 },
    { header: "Hora", key: "hora", width: 8 },
    { header: "Direção", key: "direcao", width: 10 },
    { header: "Autor", key: "autor", width: 22 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Mensagem", key: "texto", width: 80 },
    { header: "Situação", key: "situacao", width: 12 },
  ];
  aba.getRow(1).font = { bold: true };
  aba.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9FDD3" } };
  for (const l of linhas) {
    const linha = aba.addRow(l);
    linha.getCell("texto").alignment = { wrapText: true, vertical: "top" };
  }
  aba.autoFilter = { from: "A1", to: "G1" };

  const info = livro.addWorksheet("Sobre");
  info.addRows([
    ["Contato", cab.contato],
    ["Telefone", cab.telefone ?? ""],
    ["Número da empresa", cab.canal ?? ""],
    ["Mensagens", cab.total],
    ["Gerado em", cab.geradoEm],
    ...(cab.cortado
      ? [
          [
            "Aviso",
            "A conversa passou do limite do arquivo: estão aqui as mensagens mais recentes.",
          ],
        ]
      : []),
  ]);
  info.getColumn(1).font = { bold: true };
  info.getColumn(1).width = 20;
  info.getColumn(2).width = 60;

  return Buffer.from(await livro.xlsx.writeBuffer());
}
