// Exportación a PDF (jspdf + autotable) y Excel (xlsx-js-style) para las
// tablas de reportes. Se importa dinámicamente desde las páginas cliente.

export interface ColumnaExport {
  header: string;
  align?: "left" | "right" | "center";
}

export interface BaseExport {
  titulo: string;
  subtitulo?: string;
  columnas: ColumnaExport[];
  nombreArchivo: string;
}

export interface PdfExport extends BaseExport {
  filas: (string | number)[][];
  orientacion?: "portrait" | "landscape";
}

export interface ExcelExport extends BaseExport {
  filas: (string | number | null)[][];
  hoja?: string;
  /** Índices (base 0) de columnas a formatear como moneda en Excel. */
  columnasMoneda?: number[];
}

const EMPRESA = "AUTO PARTES VIDAURRI";

export async function exportarPdf(opciones: PdfExport): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: opciones.orientacion ?? "portrait", unit: "pt" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(EMPRESA, 40, 40);
  doc.setFontSize(11);
  doc.text(opciones.titulo, 40, 58);
  if (opciones.subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(opciones.subtitulo, 40, 74);
    doc.setTextColor(0);
  }

  autoTable(doc, {
    startY: opciones.subtitulo ? 88 : 72,
    head: [opciones.columnas.map((c) => c.header)],
    body: opciones.filas,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      opciones.columnas.map((c, i) => [i, { halign: c.align ?? "left" }])
    ),
    didDrawPage: () => {
      const alto = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Generado el ${new Date().toLocaleString("es-MX")} · Vidaurri IA`,
        40,
        alto - 20
      );
      doc.setTextColor(0);
    },
  });

  doc.save(`${opciones.nombreArchivo}.pdf`);
}

export async function exportarExcel(opciones: ExcelExport): Promise<void> {
  const XLSX = await import("xlsx-js-style");

  const encabezado = opciones.columnas.map((c) => ({
    v: c.header,
    t: "s" as const,
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "B45309" } },
      alignment: { horizontal: c.align ?? "left" },
    },
  }));

  const cuerpo = opciones.filas.map((fila) =>
    fila.map((celda, i) => {
      const esMoneda = opciones.columnasMoneda?.includes(i) ?? false;
      if (typeof celda === "number") {
        return {
          v: celda,
          t: "n" as const,
          s: {
            numFmt: esMoneda ? "$#,##0.00" : "#,##0",
            alignment: { horizontal: opciones.columnas[i]?.align ?? "left" },
          },
        };
      }
      return { v: celda ?? "", t: "s" as const };
    })
  );

  const hoja = XLSX.utils.aoa_to_sheet([
    [{ v: EMPRESA, t: "s", s: { font: { bold: true, sz: 13 } } }],
    [{ v: opciones.titulo, t: "s", s: { font: { bold: true } } }],
    [{ v: opciones.subtitulo ?? "", t: "s", s: { font: { color: { rgb: "666666" } } } }],
    [],
    encabezado,
    ...cuerpo,
  ]);
  hoja["!cols"] = opciones.columnas.map((c) => ({ wch: Math.max(c.header.length + 4, 14) }));

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, opciones.hoja ?? "Reporte");
  XLSX.writeFile(libro, `${opciones.nombreArchivo}.xlsx`);
}
