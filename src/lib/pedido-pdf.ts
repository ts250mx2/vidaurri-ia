// PDF de un pedido de mostrador para el cliente: lo abre desde la liga que el
// Vendedor IA le manda por WhatsApp al confirmar. Mismo motor que el PDF de
// VIDA (jsPDF + autotable, cargados bajo demanda) y misma cabecera de empresa.

import type { jsPDF } from "jspdf";
import { moneda } from "./formato";
import { textoImprimible } from "./pdf-respuesta";
import { SUCURSALES_ENTREGA, type EstatusPedido, type PedidoDetalle } from "./pedidos";

const EMPRESA = "AUTO PARTES VIDAURRI";
const MARGEN = 40;
const ALTO_PIE = 16;
const ALTO_LINEA_DATOS = 16;
const ANCHO_ETIQUETA = 78;
const AMBAR: [number, number, number] = [180, 83, 9];
const GRIS_FONDO: [number, number, number] = [245, 245, 245];
const GRIS = 110;
const GRIS_PIE = 150;

const ESTATUS_TEXTO: Record<EstatusPedido, string> = {
  borrador: "En captura",
  enviado: "Enviado al mostrador · sujeto a confirmación de existencia",
  confirmado: "Confirmado por el mostrador",
  listo: "Listo para recoger",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

const CANAL_TEXTO: Record<PedidoDetalle["canal"], string> = {
  mostrador: "Mostrador",
  whatsapp: "WhatsApp",
  web: "Página web",
};

const NOTA_SUJETO =
  "Este pedido queda sujeto a confirmación de existencia por el mostrador; no es un apartado. El mostrador avisa cuando esté listo para recoger.";

/** 'AAAA-MM-DD HH:MM:SS' (Monterrey) → 'DD/MM/AAAA HH:MM'. */
export function fechaHoraPedido(momento: string | null): string {
  if (!momento) return "—";
  const [fecha, hora = ""] = momento.split(" ");
  const [a, m, d] = fecha.split("-");
  if (!a || !m || !d) return momento;
  return `${d}/${m}/${a} ${hora.slice(0, 5)}`.trim();
}

export function nombreSucursalPedido(clave: PedidoDetalle["sucursal"]): string {
  return SUCURSALES_ENTREGA.find((s) => s.clave === clave)?.nombre ?? clave;
}

function codigoDe(partida: PedidoDetalle["partidas"][number]): string {
  if (partida.codigo) return partida.codigo;
  if (partida.idPiezaUsada !== null) return `Usada #${partida.idPiezaUsada}`;
  return "—";
}

/** Renglones de datos del pedido, en el orden en que se imprimen (dos columnas). */
export function datosDelPedido(pedido: PedidoDetalle): Array<[string, string]> {
  return [
    ["Cliente", pedido.cliente],
    ["Teléfono", pedido.telefono ?? "—"],
    ["Recoge en", nombreSucursalPedido(pedido.sucursal)],
    ["Levantado por", CANAL_TEXTO[pedido.canal]],
    ["Enviado el", fechaHoraPedido(pedido.enviadoEn)],
  ];
}

/** Notas al pie de la tabla: observaciones, motivo de cancelación o la leyenda de "sujeto a confirmación". */
export function notasDelPedido(pedido: PedidoDetalle): string[] {
  const notas: string[] = [];
  if (pedido.observaciones) notas.push(`Observaciones: ${pedido.observaciones}`);
  if (pedido.estatus === "cancelado") {
    notas.push(`Pedido cancelado${pedido.motivoCancelacion ? `: ${pedido.motivoCancelacion}` : ""}.`);
  } else {
    notas.push(NOTA_SUJETO);
  }
  return notas;
}

/** Arma el PDF y devuelve sus bytes (para servirlo como application/pdf). */
export async function generarPdfPedido(pedido: PedidoDetalle): Promise<ArrayBuffer> {
  const { default: JsPdf } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPdf({ orientation: "portrait", unit: "pt", format: "a4" });
  const anchoPagina = doc.internal.pageSize.getWidth();
  const altoPagina = doc.internal.pageSize.getHeight();
  const ancho = anchoPagina - MARGEN * 2;
  const generado = new Date().toLocaleString("es-MX");
  let y = MARGEN;

  // Cabecera: empresa a la izquierda, folio y estatus a la derecha.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0);
  doc.text(EMPRESA, MARGEN, y + 13);
  doc.setFontSize(16);
  doc.setTextColor(AMBAR[0], AMBAR[1], AMBAR[2]);
  doc.text(`Pedido ${pedido.folio ?? "en captura"}`, anchoPagina - MARGEN, y + 13, { align: "right" });
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRIS);
  doc.text(`Generado el ${generado}`, MARGEN, y + 9);
  doc.text(textoImprimible(ESTATUS_TEXTO[pedido.estatus]), anchoPagina - MARGEN, y + 9, { align: "right" });
  y += 24;

  // Datos del pedido: el cliente en un renglón completo (los nombres largos no
  // caben en media página) y el resto en dos columnas.
  const escribirDato = (etiqueta: string, valor: string, x: number, linea: number, anchoValor: number) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(GRIS);
    doc.text(`${etiqueta}:`, x, linea);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    const [recortado] = doc.splitTextToSize(textoImprimible(valor), anchoValor) as string[];
    doc.text(recortado ?? "", x + ANCHO_ETIQUETA, linea);
  };
  const [principal, ...resto] = datosDelPedido(pedido);
  doc.setFontSize(10);
  escribirDato(principal[0], principal[1], MARGEN, y + 10, ancho - ANCHO_ETIQUETA);
  resto.forEach(([etiqueta, valor], i) => {
    const x = MARGEN + (i % 2) * (ancho / 2);
    const linea = y + (1 + Math.floor(i / 2)) * ALTO_LINEA_DATOS + 10;
    escribirDato(etiqueta, valor, x, linea, ancho / 2 - ANCHO_ETIQUETA - 6);
  });
  y += (1 + Math.ceil(resto.length / 2)) * ALTO_LINEA_DATOS + 14;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN, top: MARGEN, bottom: MARGEN + ALTO_PIE },
    head: [["#", "Código", "Descripción", "Cant.", "Precio c/IVA", "Importe"]],
    body: pedido.partidas.map((p) => [
      String(p.partida),
      codigoDe(p),
      textoImprimible(p.descripcion),
      String(p.cantidad),
      moneda(p.precioUnitario),
      moneda(p.importe),
    ]),
    foot: [
      ["", "", "", "", "Subtotal", moneda(pedido.subtotal)],
      ["", "", "", "", "IVA", moneda(pedido.iva)],
      ["", "", "", "", "Total", moneda(pedido.total)],
    ],
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: AMBAR, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: GRIS_FONDO, textColor: 0, fontStyle: "bold", halign: "right" },
    columnStyles: {
      0: { halign: "right", cellWidth: 22 },
      1: { cellWidth: 92 },
      3: { halign: "right", cellWidth: 36 },
      4: { halign: "right", cellWidth: 72 },
      5: { halign: "right", cellWidth: 72 },
    },
  });
  y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRIS);
  for (const nota of notasDelPedido(pedido)) {
    const lineas = doc.splitTextToSize(textoImprimible(nota), ancho) as string[];
    if (y + lineas.length * 12 > altoPagina - MARGEN - ALTO_PIE) {
      doc.addPage();
      y = MARGEN;
    }
    doc.text(lineas, MARGEN, y + 9);
    y += lineas.length * 12 + 6;
  }

  const total = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina);
    doc.setFontSize(8);
    doc.setTextColor(GRIS_PIE);
    doc.text(`${pedido.folio ?? "Pedido"} · Generado el ${generado} · Vidaurri IA`, MARGEN, altoPagina - 20);
    doc.text(`Página ${pagina} de ${total}`, anchoPagina - MARGEN, altoPagina - 20, { align: "right" });
  }
  return doc.output("arraybuffer");
}
