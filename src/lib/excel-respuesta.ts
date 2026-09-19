// Excel de una respuesta del agente VIDA: una hoja por cada tabla de la
// respuesta, con la pregunta que la originó arriba y los números como números
// (no como texto), para poder sumarlos, ordenarlos y filtrarlos. Hermano de
// pdf-respuesta.ts: mismo parser de markdown y mismo nombre de archivo. La
// librería (xlsx-js-style) se carga al momento, como en export.ts.
//
// Solo se exportan las TABLAS: los párrafos de una respuesta no ganan nada en
// una hoja de cálculo. Una respuesta sin tablas no se exporta (SinTablasError).

import type { CellObject, WorkBook, WorkSheet } from "xlsx-js-style";
import { markdownABloques, textoDeRuns, type Alineacion, type Bloque } from "./markdown-bloques";
import { nombreArchivoRespuesta } from "./pdf-respuesta";

export interface RespuestaExcel {
  pregunta: string;
  respuesta: string;
  /** Sin extensión; si falta se arma con la fecha y la pregunta. */
  nombreArchivo?: string;
}

export interface TablaRespuesta {
  /** El encabezado de markdown más cercano antes de la tabla; null si no hay. */
  titulo: string | null;
  encabezado: string[];
  filas: string[][];
  alineacion: Alineacion[];
}

export class SinTablasError extends Error {
  constructor() {
    super("Esta respuesta no trae tablas que exportar a Excel");
    this.name = "SinTablasError";
  }
}

const EMPRESA = "AUTO PARTES VIDAURRI";
const TITULO = "VIDA · Agente IA";
const AMBAR = "B45309";
const GRIS = "666666";
/** Filas de cabecera de la hoja antes de la tabla: empresa, título, pregunta, fecha y una en blanco. */
const FILAS_DE_CABECERA = 5;
const ANCHO_MIN = 8;
const ANCHO_MAX = 60;
const NOMBRE_HOJA_MAX = 31;
/** Más dígitos que esto es un teléfono o un código, no una cantidad. */
const DIGITOS_ENTERO_MAX = 9;
const DECIMALES_MAX = 6;

/** Las tablas de la respuesta en el orden en que aparecen, también las que van dentro de citas y listas. */
export function tablasDeRespuesta(markdown: string): TablaRespuesta[] {
  const tablas: TablaRespuesta[] = [];
  let titulo: string | null = null;

  const recorrer = (bloques: Bloque[]): void => {
    for (const bloque of bloques) {
      switch (bloque.tipo) {
        case "encabezado":
          titulo = textoDeRuns(bloque.runs).trim() || null;
          break;
        case "tabla":
          if (bloque.encabezado.length > 0) {
            tablas.push({ titulo, encabezado: bloque.encabezado, filas: bloque.filas, alineacion: bloque.alineacion });
          }
          break;
        case "cita":
          recorrer(bloque.bloques);
          break;
        case "lista":
          for (const item of bloque.items) recorrer(item.bloques);
          break;
        default:
          break;
      }
    }
  };
  recorrer(markdownABloques(markdown));
  return tablas;
}

const aNumero = (texto: string): number => Number(texto.replace(/[$,%\s]/g, ""));
const decimalesDe = (texto: string): number => Math.min((texto.split(".")[1] ?? "").replace(/\D/g, "").length, DECIMALES_MAX);

const MONEDA = /^-?\$\s?-?\d[\d,]*(\.\d+)?$/;
const PORCENTAJE = /^-?\d[\d,]*(\.\d+)?\s?%$/;
const CON_MILES = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const DECIMAL = /^-?\d+\.\d+$/;
const ENTERO = /^-?\d+$/;

/** Valor y formato de Excel para el texto de una celda; null si debe quedarse como texto. */
export function numeroDeCelda(texto: string): { valor: number; formato: string } | null {
  const t = texto.trim();
  if (MONEDA.test(t)) return { valor: aNumero(t), formato: "$#,##0.00" };
  if (PORCENTAJE.test(t)) {
    return { valor: aNumero(t) / 100, formato: decimalesDe(t) > 0 ? `0.${"0".repeat(decimalesDe(t))}%` : "0%" };
  }
  if (CON_MILES.test(t)) {
    return { valor: aNumero(t), formato: decimalesDe(t) > 0 ? `#,##0.${"0".repeat(decimalesDe(t))}` : "#,##0" };
  }
  if (DECIMAL.test(t)) return { valor: aNumero(t), formato: `0.${"0".repeat(decimalesDe(t))}` };
  if (ENTERO.test(t)) {
    // Un folio (166789) o un año (2015) no llevan separador de miles; un
    // teléfono o un código con cero inicial se quedan como texto.
    const digitos = t.replace("-", "");
    const conCeroInicial = digitos.length > 1 && digitos.startsWith("0");
    if (conCeroInicial || digitos.length > DIGITOS_ENTERO_MAX) return null;
    return { valor: aNumero(t), formato: "0" };
  }
  return null;
}

function celdaDeDato(texto: string, alineacion: Alineacion): CellObject {
  const numero = numeroDeCelda(texto);
  if (numero) {
    // Los números van a la derecha salvo que la tabla los centre a propósito.
    const horizontal = alineacion === "center" ? "center" : "right";
    return { v: numero.valor, t: "n", s: { numFmt: numero.formato, alignment: { horizontal } } };
  }
  return { v: texto.trim(), t: "s", s: { alignment: { horizontal: alineacion, vertical: "top", wrapText: texto.length > ANCHO_MAX } } };
}

function celdaDeEncabezado(texto: string, alineacion: Alineacion): CellObject {
  return {
    v: texto.trim(),
    t: "s",
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: AMBAR } },
      alignment: { horizontal: alineacion, vertical: "center", wrapText: true },
    },
  };
}

/** Nombre de hoja válido en Excel: sin : \ / ? * [ ], máximo 31 caracteres y sin repetir. */
export function nombreDeHoja(titulo: string | null, numero: number, usados: ReadonlySet<string>): string {
  const limpio = (titulo ?? "").replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
  const base = limpio || `Tabla ${numero}`;
  let nombre = base.slice(0, NOMBRE_HOJA_MAX).trim();
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
    const sufijo = ` (${n})`;
    nombre = base.slice(0, NOMBRE_HOJA_MAX - sufijo.length).trim() + sufijo;
  }
  return nombre;
}

function anchosDe(tabla: TablaRespuesta): Array<{ wch: number }> {
  return tabla.encabezado.map((encabezado, i) => {
    const largo = Math.max(encabezado.length, ...tabla.filas.map((fila) => (fila[i] ?? "").length));
    return { wch: Math.min(Math.max(largo + 2, ANCHO_MIN), ANCHO_MAX) };
  });
}

/** El libro ya armado, sin descargarlo (para poder probarlo). Lanza SinTablasError si no hay tablas. */
export async function generarLibroRespuesta(opciones: RespuestaExcel, fecha = new Date()): Promise<WorkBook> {
  const tablas = tablasDeRespuesta(opciones.respuesta);
  if (tablas.length === 0) throw new SinTablasError();
  const XLSX = await import("xlsx-js-style");

  const libro = XLSX.utils.book_new();
  const usados = new Set<string>();
  const pregunta = opciones.pregunta.trim();
  const generado = `Generado el ${fecha.toLocaleString("es-MX")} · Vidaurri IA`;

  tablas.forEach((tabla, indice) => {
    const columnas = tabla.encabezado.length;
    const alineacionDe = (i: number): Alineacion => tabla.alineacion[i] ?? "left";
    const subtitulo = [TITULO, tabla.titulo, tablas.length > 1 ? `tabla ${indice + 1} de ${tablas.length}` : null]
      .filter(Boolean)
      .join(" — ");

    const hoja: WorkSheet = XLSX.utils.aoa_to_sheet([
      [{ v: EMPRESA, t: "s", s: { font: { bold: true, sz: 13 } } }],
      [{ v: subtitulo, t: "s", s: { font: { bold: true } } }],
      [{ v: pregunta ? `Pregunta: ${pregunta}` : "", t: "s", s: { font: { italic: true, color: { rgb: GRIS } } } }],
      [{ v: generado, t: "s", s: { font: { color: { rgb: GRIS } } } }],
      [],
      tabla.encabezado.map((texto, i) => celdaDeEncabezado(texto, alineacionDe(i))),
      // Una fila con menos celdas que el encabezado se completa con vacías.
      ...tabla.filas.map((fila) =>
        Array.from({ length: columnas }, (_, i) => celdaDeDato(fila[i] ?? "", alineacionDe(i)))
      ),
    ]);
    hoja["!cols"] = anchosDe(tabla);
    // Filtro sobre la tabla: ordenar y filtrar es para lo que se quiere el Excel.
    hoja["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: FILAS_DE_CABECERA, c: 0 },
        e: { r: FILAS_DE_CABECERA + tabla.filas.length, c: columnas - 1 },
      }),
    };

    const nombre = nombreDeHoja(tabla.titulo, indice + 1, usados);
    usados.add(nombre.toLowerCase());
    XLSX.utils.book_append_sheet(libro, hoja, nombre);
  });
  return libro;
}

/** Descarga el Excel en el navegador. */
export async function exportarRespuestaExcel(opciones: RespuestaExcel): Promise<void> {
  const libro = await generarLibroRespuesta(opciones);
  const XLSX = await import("xlsx-js-style");
  XLSX.writeFile(libro, `${opciones.nombreArchivo ?? nombreArchivoRespuesta(opciones.pregunta)}.xlsx`);
}
