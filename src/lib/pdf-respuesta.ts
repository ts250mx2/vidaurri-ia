// PDF de una respuesta del agente VIDA: encabezado de la empresa, la pregunta
// que la originó y la respuesta con su formato (negritas, listas, tablas,
// código, citas). jsPDF y autotable se cargan al momento, como en export.ts,
// para no meterlos en el paquete inicial de la página.

import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import { markdownABloques, type Bloque, type Run } from "./markdown-bloques";

export interface RespuestaPdf {
  pregunta: string;
  respuesta: string;
  /** Sin extensión; si falta se arma con la fecha y la pregunta. */
  nombreArchivo?: string;
}

const EMPRESA = "AUTO PARTES VIDAURRI";
const TITULO = "VIDA · Agente IA — respuesta";
const MARGEN = 40;
const TAMANO = 10;
const TAMANO_CODIGO = 8.5;
const TAMANO_TABLA = 8.5;
const INTERLINEADO = 1.4;
const SANGRIA = 16;
const RELLENO_CODIGO = 6;
const ALTO_PIE = 16;
const AMBAR: [number, number, number] = [180, 83, 9];
const GRIS_TEXTO = 110;
const GRIS_CITA = 90;
const GRIS_CODIGO = 60;
const GRIS_FONDO = 245;
const GRIS_LINEA = 200;
const GRIS_PIE = 150;
const TAMANO_ENCABEZADO: Record<number, number> = { 1: 14, 2: 12.5, 3: 11.5 };
const TAMANO_ENCABEZADO_MENOR = 10.5;

type Color = number | [number, number, number];
type Estilo = Omit<Run, "texto">;

const SIN_ESTILO: Estilo = { negrita: false, cursiva: false, codigo: false };

// Los rangos de caracteres se arman por código y no con escapes en el fuente:
// un editor o herramienta puede convertir "\u0000" en el byte real y dejar el
// archivo como binario para git y grep (pasó al crear este archivo).
const ULTIMO_LATIN1 = 0xff;
const ESPACIO_DURO = String.fromCharCode(0xa0);
/** Puntuación fuera de Latin-1 que sí traen las fuentes estándar (Windows-1252). */
const PUNTUACION_WINANSI = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]);
const PRIMER_DIACRITICO = 0x300;
const ULTIMO_DIACRITICO = 0x36f;

/** Símbolos que las fuentes estándar no tienen pero sí tienen equivalente en texto. */
const REEMPLAZOS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "✓": "OK",
  "✔": "OK",
  "✗": "X",
  "✘": "X",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "★": "*",
  "☆": "*",
  [ESPACIO_DURO]: " ",
};

function traducirCaracter(caracter: string): string {
  const reemplazo = REEMPLAZOS[caracter];
  if (reemplazo !== undefined) return reemplazo;
  const codigo = caracter.codePointAt(0) ?? 0;
  return codigo <= ULTIMO_LATIN1 || PUNTUACION_WINANSI.has(codigo) ? caracter : "";
}

/**
 * Las fuentes estándar de jsPDF solo saben Latin-1 (más la puntuación de
 * Windows-1252): los emojis y símbolos que a veces escribe el agente saldrían
 * como basura, así que se traducen o se quitan.
 */
export function textoImprimible(texto: string): string {
  return (
    Array.from(texto, traducirCaracter)
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      // "ventas 🚀, un…" sin el emoji quedaría "ventas , un…"
      .replace(/ +([,.;:!?])/g, "$1")
  );
}

function sinDiacriticos(texto: string): string {
  return Array.from(texto.normalize("NFD"))
    .filter((c) => {
      const codigo = c.charCodeAt(0);
      return codigo < PRIMER_DIACRITICO || codigo > ULTIMO_DIACRITICO;
    })
    .join("");
}

/** 'vida-20260902-1530-como-van-las-ventas-de-hoy' */
export function nombreArchivoRespuesta(pregunta: string, fecha = new Date()): string {
  const slug = sinDiacriticos(pregunta.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const dos = (n: number) => String(n).padStart(2, "0");
  const sello = `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
  return `vida-${sello}${slug ? `-${slug}` : ""}`;
}

interface Cursor {
  doc: jsPDF;
  autoTable: (doc: jsPDF, opciones: UserOptions) => void;
  /** Borde superior de lo siguiente que se escriba. */
  y: number;
  /** Hasta dónde se puede escribir antes del pie de página. */
  limite: number;
}

function aplicarColor(doc: jsPDF, color: Color): void {
  if (typeof color === "number") doc.setTextColor(color);
  else doc.setTextColor(color[0], color[1], color[2]);
}

function fuente(doc: jsPDF, estilo: Estilo): void {
  if (estilo.codigo) {
    doc.setFont("courier", estilo.negrita ? "bold" : "normal");
    return;
  }
  const variante =
    estilo.negrita && estilo.cursiva
      ? "bolditalic"
      : estilo.negrita
        ? "bold"
        : estilo.cursiva
          ? "italic"
          : "normal";
  doc.setFont("helvetica", variante);
}

function saltoSiHaceFalta(c: Cursor, alto: number): void {
  if (c.y + alto <= c.limite) return;
  c.doc.addPage();
  c.y = MARGEN;
}

interface OpcionesTexto {
  x: number;
  ancho: number;
  tamano: number;
  color: Color;
  /** Estilo que se suma al de cada run (p. ej. todo en negritas en un encabezado). */
  base?: Partial<Estilo>;
}

function combinarEstilo(run: Run, base?: Partial<Estilo>): Estilo {
  return {
    negrita: run.negrita || base?.negrita === true,
    cursiva: run.cursiva || base?.cursiva === true,
    codigo: run.codigo || base?.codigo === true,
  };
}

/** Tramo de una línea con un solo estilo; se dibuja con una sola llamada. */
interface Segmento {
  estilo: Estilo;
  texto: string;
  x: number;
}

/**
 * Escribe runs con salto de línea por palabra y cambio de fuente por run;
 * deja el cursor bajo la última línea y cambia de página si hace falta. Cada
 * tramo de un mismo estilo se dibuja entero (no palabra por palabra) para que
 * los espacios los ponga la fuente y no una suma de anchos medidos.
 */
function escribirRuns(c: Cursor, runs: Run[], o: OpcionesTexto): void {
  const { doc } = c;
  const altoLinea = o.tamano * INTERLINEADO;
  const derecha = o.x + o.ancho;
  doc.setFontSize(o.tamano);
  saltoSiHaceFalta(c, altoLinea);

  let terminados: Segmento[] = [];
  let actual: Segmento = { estilo: SIN_ESTILO, texto: "", x: o.x };

  // Los espacios finales se suman aparte: de ellos depende dónde arranca el
  // siguiente tramo, y la medición de jsPDF no es de fiar con ellos.
  const anchoDe = (s: Segmento) => {
    fuente(doc, s.estilo);
    const sinFinales = s.texto.replace(/ +$/, "");
    const finales = s.texto.length - sinFinales.length;
    return doc.getTextWidth(sinFinales) + finales * doc.getTextWidth(" ");
  };
  const lineaVacia = () => [...terminados, actual].every((s) => s.texto.trim() === "");
  const dibujarLinea = () => {
    aplicarColor(doc, o.color);
    for (const s of [...terminados, actual]) {
      if (!s.texto) continue;
      fuente(doc, s.estilo);
      doc.text(s.texto, s.x, c.y + o.tamano);
    }
    c.y += altoLinea;
    terminados = [];
  };
  const nuevaLinea = (estilo: Estilo, texto: string) => {
    dibujarLinea();
    saltoSiHaceFalta(c, altoLinea);
    actual = { estilo, texto, x: o.x };
  };

  for (const run of runs) {
    const estilo = combinarEstilo(run, o.base);
    const x = actual.x + anchoDe(actual);
    terminados = [...terminados, actual];
    actual = { estilo, texto: "", x };

    for (const parte of textoImprimible(run.texto).split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(parte)) {
        if (parte.includes("\n")) nuevaLinea(estilo, "");
        else if (!lineaVacia()) actual = { ...actual, texto: `${actual.texto} ` };
        continue;
      }
      const candidato: Segmento = { ...actual, texto: actual.texto + parte };
      if (!lineaVacia() && candidato.x + anchoDe(candidato) > derecha) nuevaLinea(estilo, parte);
      else actual = candidato;
    }
  }
  dibujarLinea();
}

/** '1.', '•' o, en listas de tareas, '[x]' / '[ ]' (las casillas no existen en las fuentes estándar). */
function prefijoDeItem(lista: Extract<Bloque, { tipo: "lista" }>, indice: number): string {
  if (lista.ordenada) return `${lista.inicio + indice}.`;
  const { marcado } = lista.items[indice];
  if (marcado === null) return "•";
  return marcado ? "[x]" : "[ ]";
}

function escribirLista(
  c: Cursor,
  lista: Extract<Bloque, { tipo: "lista" }>,
  x: number,
  ancho: number,
  color: Color
): void {
  const altoLinea = TAMANO * INTERLINEADO;
  lista.items.forEach((item, i) => {
    saltoSiHaceFalta(c, altoLinea);
    fuente(c.doc, SIN_ESTILO);
    c.doc.setFontSize(TAMANO);
    aplicarColor(c.doc, color);
    c.doc.text(prefijoDeItem(lista, i), x, c.y + TAMANO);
    if (item.bloques.length === 0) {
      c.y += altoLinea;
      return;
    }
    escribirBloques(c, item.bloques, x + SANGRIA, ancho - SANGRIA, color);
  });
  c.y += 2;
}

function escribirTabla(
  c: Cursor,
  tabla: Extract<Bloque, { tipo: "tabla" }>,
  x: number,
  ancho: number
): void {
  if (tabla.encabezado.length === 0) return;
  c.autoTable(c.doc, {
    startY: c.y,
    margin: { left: x, right: MARGEN, top: MARGEN, bottom: MARGEN + ALTO_PIE },
    tableWidth: ancho,
    head: [tabla.encabezado.map(textoImprimible)],
    body: tabla.filas.map((fila) => fila.map(textoImprimible)),
    styles: { font: "helvetica", fontSize: TAMANO_TABLA, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: AMBAR, textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries(tabla.alineacion.map((a, i) => [i, { halign: a }])),
  });
  const final = (c.doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
  c.y = (final ?? c.y) + 8;
}

/** Fondo gris línea por línea: así sobrevive a un salto de página a la mitad. */
function escribirCodigo(c: Cursor, texto: string, x: number, ancho: number): void {
  const altoLinea = TAMANO_CODIGO * INTERLINEADO;
  c.doc.setFont("courier", "normal");
  c.doc.setFontSize(TAMANO_CODIGO);
  const lineas = c.doc.splitTextToSize(textoImprimible(texto), ancho - RELLENO_CODIGO * 2) as string[];
  c.y += 2;
  for (const linea of lineas) {
    saltoSiHaceFalta(c, altoLinea);
    c.doc.setFillColor(GRIS_FONDO, GRIS_FONDO, GRIS_FONDO);
    c.doc.rect(x, c.y, ancho, altoLinea, "F");
    aplicarColor(c.doc, GRIS_CODIGO);
    c.doc.text(linea, x + RELLENO_CODIGO, c.y + TAMANO_CODIGO);
    c.y += altoLinea;
  }
  c.y += 6;
}

function escribirBloques(c: Cursor, bloques: Bloque[], x: number, ancho: number, color: Color): void {
  for (const bloque of bloques) {
    switch (bloque.tipo) {
      case "encabezado": {
        const tamano = TAMANO_ENCABEZADO[bloque.nivel] ?? TAMANO_ENCABEZADO_MENOR;
        c.y += 4;
        escribirRuns(c, bloque.runs, { x, ancho, tamano, color: AMBAR, base: { negrita: true } });
        c.y += 2;
        break;
      }
      case "parrafo":
        escribirRuns(c, bloque.runs, { x, ancho, tamano: TAMANO, color });
        c.y += 4;
        break;
      case "lista":
        escribirLista(c, bloque, x, ancho, color);
        break;
      case "tabla":
        escribirTabla(c, bloque, x, ancho);
        break;
      case "codigo":
        escribirCodigo(c, bloque.texto, x, ancho);
        break;
      case "cita":
        escribirBloques(c, bloque.bloques, x + SANGRIA, ancho - SANGRIA, GRIS_CITA);
        break;
      case "linea":
        c.doc.setDrawColor(GRIS_LINEA, GRIS_LINEA, GRIS_LINEA);
        c.doc.line(x, c.y + 3, x + ancho, c.y + 3);
        c.y += 10;
        break;
    }
  }
}

function etiqueta(c: Cursor, texto: string): void {
  saltoSiHaceFalta(c, 14);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(8);
  aplicarColor(c.doc, AMBAR);
  c.doc.text(texto.toUpperCase(), MARGEN, c.y + 8);
  c.y += 14;
}

function pieDePagina(doc: jsPDF, generado: string): void {
  const total = doc.getNumberOfPages();
  const anchoPagina = doc.internal.pageSize.getWidth();
  const altoPagina = doc.internal.pageSize.getHeight();
  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    aplicarColor(doc, GRIS_PIE);
    doc.text(`Generado el ${generado} · Vidaurri IA`, MARGEN, altoPagina - 20);
    doc.text(`Página ${pagina} de ${total}`, anchoPagina - MARGEN, altoPagina - 20, {
      align: "right",
    });
  }
}

/** Arma el documento; separado de `exportarRespuestaPdf` para poder probarlo sin navegador. */
export async function generarPdfRespuesta(opciones: RespuestaPdf): Promise<jsPDF> {
  const { default: JsPdf } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPdf({ orientation: "portrait", unit: "pt", format: "a4" });
  const ancho = doc.internal.pageSize.getWidth() - MARGEN * 2;
  const c: Cursor = {
    doc,
    autoTable,
    y: MARGEN,
    limite: doc.internal.pageSize.getHeight() - MARGEN - ALTO_PIE,
  };
  const generado = new Date().toLocaleString("es-MX");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  aplicarColor(doc, 0);
  doc.text(EMPRESA, MARGEN, c.y + 13);
  c.y += 18;
  doc.setFontSize(11);
  doc.text(textoImprimible(TITULO), MARGEN, c.y + 11);
  c.y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  aplicarColor(doc, GRIS_TEXTO);
  doc.text(`Generado el ${generado}`, MARGEN, c.y + 9);
  c.y += 22;

  const pregunta = opciones.pregunta.trim();
  if (pregunta) {
    etiqueta(c, "Pregunta");
    escribirRuns(c, [{ texto: pregunta, ...SIN_ESTILO, cursiva: true }], {
      x: MARGEN,
      ancho,
      tamano: TAMANO,
      color: GRIS_CODIGO,
    });
    c.y += 8;
  }
  etiqueta(c, "Respuesta");
  escribirBloques(c, markdownABloques(opciones.respuesta), MARGEN, ancho, 0);

  pieDePagina(doc, generado);
  return doc;
}

/** Descarga el PDF en el navegador. */
export async function exportarRespuestaPdf(opciones: RespuestaPdf): Promise<void> {
  const doc = await generarPdfRespuesta(opciones);
  doc.save(`${opciones.nombreArchivo ?? nombreArchivoRespuesta(opciones.pregunta)}.pdf`);
}
