import { describe, expect, it } from "vitest";
import { markdownABloques, textoDeRuns, type Bloque, type Run } from "./markdown-bloques";

const RESPUESTA_VIDA = `## Ventas de hoy

Hoy se vendieron **$12,345.00** en *14 tickets*. Detalle:

| Artículo | Cantidad | Importe |
|:---------|---------:|--------:|
| Cofre Tsuru | 3 | $4,500.00 |
| Facia Versa | 2 | $3,200.00 |

- Mejor cliente: **Taller López**
  - Compró 5 piezas
- Sin ventas en Bodega Usado

1. Revisar existencias
2. Ofrecer \`sobre pedido\`

> Nota: cifras con IVA.

---

\`\`\`sql
SELECT SUM(total) FROM ventas WHERE fecha = CURDATE();
\`\`\`
`;

function tipos(bloques: Bloque[]): string[] {
  return bloques.map((b) => b.tipo);
}

describe("markdownABloques", () => {
  it("reconoce cada tipo de bloque que responde VIDA", () => {
    expect(tipos(markdownABloques(RESPUESTA_VIDA))).toEqual([
      "encabezado",
      "parrafo",
      "tabla",
      "lista",
      "lista",
      "cita",
      "linea",
      "codigo",
    ]);
  });

  it("conserva negritas, cursivas y código en línea como runs", () => {
    const [, parrafo] = markdownABloques(RESPUESTA_VIDA);
    if (parrafo.tipo !== "parrafo") throw new Error("esperaba un párrafo");
    expect(textoDeRuns(parrafo.runs)).toBe("Hoy se vendieron $12,345.00 en 14 tickets. Detalle:");
    expect(parrafo.runs.find((r) => r.negrita)?.texto).toBe("$12,345.00");
    expect(parrafo.runs.find((r) => r.cursiva)?.texto).toBe("14 tickets");
  });

  it("la tabla separa encabezado, filas y alineación", () => {
    const tabla = markdownABloques(RESPUESTA_VIDA)[2];
    if (tabla.tipo !== "tabla") throw new Error("esperaba una tabla");
    expect(tabla.encabezado).toEqual(["Artículo", "Cantidad", "Importe"]);
    expect(tabla.filas).toEqual([
      ["Cofre Tsuru", "3", "$4,500.00"],
      ["Facia Versa", "2", "$3,200.00"],
    ]);
    expect(tabla.alineacion).toEqual(["left", "right", "right"]);
  });

  it("las listas conservan anidación, numeración y formato de sus items", () => {
    const [, , , viñetas, numerada] = markdownABloques(RESPUESTA_VIDA);
    if (viñetas.tipo !== "lista" || numerada.tipo !== "lista") throw new Error("esperaba listas");
    expect(viñetas.ordenada).toBe(false);
    expect(viñetas.items).toHaveLength(2);
    expect(tipos(viñetas.items[0].bloques)).toEqual(["parrafo", "lista"]);
    expect(viñetas.items.map((i) => i.marcado)).toEqual([null, null]);
    expect(numerada.ordenada).toBe(true);
    expect(numerada.inicio).toBe(1);
    const segundo = numerada.items[1].bloques[0];
    if (segundo.tipo !== "parrafo") throw new Error("esperaba un párrafo");
    expect(segundo.runs.find((r) => r.codigo)?.texto).toBe("sobre pedido");
  });

  it("las listas de tareas conservan la casilla", () => {
    const [lista] = markdownABloques("- [x] Revisar surtido\n- [ ] Llamar al cliente\n- Sin casilla");
    if (lista.tipo !== "lista") throw new Error("esperaba una lista");
    expect(lista.items.map((i) => i.marcado)).toEqual([true, false, null]);
    expect(textoDeRuns((lista.items[0].bloques[0] as { runs: Run[] }).runs)).toBe("Revisar surtido");
  });

  it("las notas al pie se imprimen con su marca en vez de perderse", () => {
    const bloques = markdownABloques("Cifras con IVA[^1].\n\n[^1]: Según la tabla ventas.");
    expect(tipos(bloques)).toEqual(["parrafo", "parrafo"]);
    const [texto, nota] = bloques as { runs: Run[] }[];
    expect(textoDeRuns(texto.runs)).toBe("Cifras con IVA[1].");
    expect(textoDeRuns(nota.runs)).toBe("[1] Según la tabla ventas.");
  });

  it("citas y código guardan su contenido", () => {
    const bloques = markdownABloques(RESPUESTA_VIDA);
    const cita = bloques[5];
    const codigo = bloques[7];
    if (cita.tipo !== "cita" || codigo.tipo !== "codigo") throw new Error("esperaba cita y código");
    expect(tipos(cita.bloques)).toEqual(["parrafo"]);
    expect(codigo.texto).toBe("SELECT SUM(total) FROM ventas WHERE fecha = CURDATE();");
  });

  it("enlaces e imágenes quedan como texto; el HTML crudo no se imprime", () => {
    const [parrafo] = markdownABloques(
      "Ver [el artículo](/dashboard/articulos) y ![Foto del cofre](/api/articulos/foto?codigo=X) <b>html</b>"
    );
    if (parrafo.tipo !== "parrafo") throw new Error("esperaba un párrafo");
    expect(textoDeRuns(parrafo.runs)).toBe("Ver el artículo y Foto del cofre html");
  });

  it("un texto vacío no produce bloques", () => {
    expect(markdownABloques("")).toEqual([]);
    expect(markdownABloques("   \n  ")).toEqual([]);
  });
});
