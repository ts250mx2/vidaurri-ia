import { describe, expect, it } from "vitest";
import type { CellObject, WorkSheet } from "xlsx-js-style";
import {
  SinTablasError,
  generarLibroRespuesta,
  nombreDeHoja,
  numeroDeCelda,
  tablasDeRespuesta,
} from "./excel-respuesta";
import { tieneTablas } from "./tiene-tablas";

const RESPUESTA = `## Ventas de hoy

Se vendieron **$12,345.00** en *14 tickets*.

| Artículo | Cantidad | Importe | Margen | Folio |
|:---|--:|--:|--:|:-:|
| **Cofre Versa 15-19** | 3 | $5,129.52 | 12.5% | 166789 |
| Faro Aveo | 1,250 | $1,044.00 | 8% | 000123 |

### Por cliente

| Cliente | Teléfono | Total |
|---|---|--:|
| Taller López | 8186921848 | $4,500.00 |

> Cifras con IVA.
`;

const celda = (hoja: WorkSheet, ref: string): CellObject => hoja[ref] as CellObject;

describe("tieneTablas", () => {
  it("reconoce la fila delimitadora de una tabla y no se confunde con una línea horizontal", () => {
    expect(tieneTablas(RESPUESTA)).toBe(true);
    expect(tieneTablas("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(true);
    expect(tieneTablas("Sin datos para hoy.\n\n---\n\nFin.")).toBe(false);
    expect(tieneTablas("Ventas: 3 | Devoluciones: 1")).toBe(false);
  });

  it("no esconde el botón ante nada que el parser sí sepa exportar", () => {
    // El detector es una heurística barata; el parser es la verdad. Toda forma
    // de tabla que el parser reconozca tiene que encender también el detector.
    const formas = [
      "| a |\n| - |\n| 1 |", // un solo guion también delimita
      "a | b\n--- | ---\n1 | 2", // sin barras en los extremos
      "| a | b |\n|:-:|--:|\n| 1 | 2 |", // con alineación
      "> | a | b |\n> |---|---|\n> | 1 | 2 |", // dentro de una cita
      "> > | a | b |\n> > |---|---|\n> > | 1 | 2 |", // cita dentro de cita
      "- Detalle:\n\n  | c | d |\n  |---|---|\n  | 3 | 4 |", // indentada dentro de una lista
    ];
    for (const markdown of formas) {
      expect(tablasDeRespuesta(markdown).length, markdown).toBeGreaterThan(0);
      expect(tieneTablas(markdown), markdown).toBe(true);
    }
  });
});

describe("tablasDeRespuesta", () => {
  it("saca cada tabla con su encabezado de markdown más cercano y el texto sin asteriscos", () => {
    const tablas = tablasDeRespuesta(RESPUESTA);

    expect(tablas.map((t) => t.titulo)).toEqual(["Ventas de hoy", "Por cliente"]);
    expect(tablas[0].encabezado).toEqual(["Artículo", "Cantidad", "Importe", "Margen", "Folio"]);
    expect(tablas[0].filas[0][0]).toBe("Cofre Versa 15-19");
    expect(tablas[0].alineacion).toEqual(["left", "right", "right", "right", "center"]);
  });

  it("también encuentra las tablas que van dentro de una cita o de una lista", () => {
    const anidadas = `> | a | b |\n> |---|---|\n> | 1 | 2 |\n\n- Detalle:\n\n  | c | d |\n  |---|---|\n  | 3 | 4 |\n`;

    expect(tablasDeRespuesta(anidadas).map((t) => t.encabezado)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("una respuesta sin tablas no da ninguna", () => {
    expect(tablasDeRespuesta("Sin datos para hoy.")).toEqual([]);
  });
});

describe("numeroDeCelda", () => {
  it("dinero, porcentajes y cantidades con miles van como número con su formato", () => {
    expect(numeroDeCelda("$5,129.52")).toEqual({ valor: 5129.52, formato: "$#,##0.00" });
    expect(numeroDeCelda("-$1,044.00")).toEqual({ valor: -1044, formato: "$#,##0.00" });
    expect(numeroDeCelda("12.5%")).toEqual({ valor: 0.125, formato: "0.0%" });
    expect(numeroDeCelda("8%")).toEqual({ valor: 0.08, formato: "0%" });
    expect(numeroDeCelda("1,250")).toEqual({ valor: 1250, formato: "#,##0" });
    expect(numeroDeCelda("1,250.75")).toEqual({ valor: 1250.75, formato: "#,##0.00" });
    expect(numeroDeCelda("3.5")).toEqual({ valor: 3.5, formato: "0.0" });
  });

  it("un entero suelto va sin separador de miles: un folio o un año no son '166,789'", () => {
    expect(numeroDeCelda("166789")).toEqual({ valor: 166789, formato: "0" });
    expect(numeroDeCelda("2015")).toEqual({ valor: 2015, formato: "0" });
    expect(numeroDeCelda("0")).toEqual({ valor: 0, formato: "0" });
  });

  it("teléfonos, códigos con cero inicial, códigos de pieza y fechas se quedan como texto", () => {
    for (const texto of ["8186921848", "000123", "CNVE15", "20-C031-B5-6B", "2026-09-03", "03/09/2026", "Mas de 60", "", "—"]) {
      expect(numeroDeCelda(texto)).toBeNull();
    }
  });
});

describe("nombreDeHoja", () => {
  it("usa el título sin los caracteres que Excel prohíbe, recortado a 31 y sin repetir", () => {
    expect(nombreDeHoja("Ventas: hoy / ayer [resumen]", 1, new Set())).toBe("Ventas hoy ayer resumen");
    expect(nombreDeHoja(null, 2, new Set())).toBe("Tabla 2");
    expect(nombreDeHoja("Comparativo de ventas por línea y por sucursal", 1, new Set()).length).toBeLessThanOrEqual(31);
    expect(nombreDeHoja("Ventas", 2, new Set(["ventas"]))).toBe("Ventas (2)");
  });
});

describe("generarLibroRespuesta", () => {
  it("arma una hoja por tabla, con la pregunta arriba y los números como números", async () => {
    const libro = await generarLibroRespuesta(
      { pregunta: "¿Cómo van las ventas de hoy?", respuesta: RESPUESTA },
      new Date(2026, 8, 19, 10, 30)
    );

    expect(libro.SheetNames).toEqual(["Ventas de hoy", "Por cliente"]);
    const hoja = libro.Sheets["Ventas de hoy"];
    expect(celda(hoja, "A1").v).toBe("AUTO PARTES VIDAURRI");
    expect(celda(hoja, "A2").v).toBe("VIDA · Agente IA — Ventas de hoy — tabla 1 de 2");
    expect(celda(hoja, "A3").v).toBe("Pregunta: ¿Cómo van las ventas de hoy?");

    // Fila 6 = encabezados; fila 7 = primer renglón de datos.
    expect(celda(hoja, "A6")).toMatchObject({ v: "Artículo", t: "s" });
    expect(celda(hoja, "A7")).toMatchObject({ v: "Cofre Versa 15-19", t: "s" });
    expect(celda(hoja, "B7")).toMatchObject({ v: 3, t: "n" });
    expect(celda(hoja, "C7")).toMatchObject({ v: 5129.52, t: "n", s: { numFmt: "$#,##0.00" } });
    expect(celda(hoja, "D7")).toMatchObject({ v: 0.125, t: "n", s: { numFmt: "0.0%" } });
    expect(celda(hoja, "E7")).toMatchObject({ v: 166789, t: "n", s: { numFmt: "0" } });
    expect(celda(hoja, "B8")).toMatchObject({ v: 1250, t: "n", s: { numFmt: "#,##0" } });
    expect(celda(hoja, "E8")).toMatchObject({ v: "000123", t: "s" });
    expect(hoja["!autofilter"]).toEqual({ ref: "A6:E8" });

    // El teléfono de la segunda tabla no se vuelve número.
    expect(celda(libro.Sheets["Por cliente"], "B7")).toMatchObject({ v: "8186921848", t: "s" });
  });

  it("una fila con menos celdas que el encabezado se completa con vacías", async () => {
    const libro = await generarLibroRespuesta({ pregunta: "", respuesta: "| a | b | c |\n|---|---|---|\n| 1 | 2 |\n" });
    const hoja = libro.Sheets["Tabla 1"];

    expect(celda(hoja, "A3").v).toBe("");
    expect(celda(hoja, "C7")).toMatchObject({ v: "", t: "s" });
  });

  it("una respuesta sin tablas no se exporta", async () => {
    await expect(generarLibroRespuesta({ pregunta: "x", respuesta: "Sin datos para hoy." })).rejects.toBeInstanceOf(
      SinTablasError
    );
  });
});
