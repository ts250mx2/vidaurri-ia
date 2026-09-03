import { describe, expect, it } from "vitest";
import { generarPdfRespuesta, nombreArchivoRespuesta, textoImprimible } from "./pdf-respuesta";

describe("textoImprimible", () => {
  it("conserva acentos, eñes, signos de dinero y la puntuación tipográfica", () => {
    const texto = "Cofre Tsuru ’98 — $4,500.00 (con IVA)… ñandú, 25 € • listo";
    expect(textoImprimible(texto)).toBe(texto);
  });

  it("traduce símbolos con equivalente y quita emojis", () => {
    expect(textoImprimible("Ventas ↑ 12% → meta ✓ 🚀 ok ✅")).toBe("Ventas ^ 12% -> meta OK ok ");
    expect(textoImprimible("a b‍c")).toBe("a bc");
  });

  it("un emoji quitado no deja su espacio pegado a la puntuación", () => {
    expect(textoImprimible("37 tickets 🚀, un 12% más 🎉.")).toBe("37 tickets, un 12% más.");
  });
});

describe("nombreArchivoRespuesta", () => {
  it("lleva fecha, hora y la pregunta como slug corto", () => {
    const fecha = new Date(2026, 8, 2, 15, 30);
    expect(nombreArchivoRespuesta("¿Cómo van las ventas de hoy?", fecha)).toBe(
      "vida-20260902-1530-como-van-las-ventas-de-hoy"
    );
    expect(nombreArchivoRespuesta("", fecha)).toBe("vida-20260902-1530");
    expect(
      nombreArchivoRespuesta("Compara las ventas de este mes contra el mes anterior por línea", fecha)
    ).toBe("vida-20260902-1530-compara-las-ventas-de-este-mes-contra-el");
  });
});

describe("generarPdfRespuesta", () => {
  it("arma un PDF de varias páginas con tabla larga, listas y código", async () => {
    const filas = Array.from({ length: 70 }, (_, i) => `| Artículo ${i} | ${i} | $${i}.00 |`).join("\n");
    const respuesta = `## Ventas de hoy

Se vendieron **$12,345.00** en *14 tickets* 🚀.

| Artículo | Cantidad | Importe |
|:---|--:|--:|
${filas}

- Mejor cliente: **Taller López**
  - Compró 5 piezas
1. Revisar existencias

- [x] Revisar surtido
- [ ] Llamar al cliente

> Nota: cifras con IVA[^1].

[^1]: Según la tabla ventas.

\`\`\`sql
SELECT SUM(total) FROM ventas;
\`\`\`
`;

    const doc = await generarPdfRespuesta({ pregunta: "¿Cómo van las ventas de hoy?", respuesta });

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(2000);
  }, 20000);

  it("una respuesta sin pregunta y sin formato también sale", async () => {
    const doc = await generarPdfRespuesta({ pregunta: "", respuesta: "Sin datos para hoy." });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
