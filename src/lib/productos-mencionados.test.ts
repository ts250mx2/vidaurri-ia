import { describe, expect, it } from "vitest";
import { codigoMencionado, MAX_PRODUCTOS_MENCIONADOS, productosMencionados } from "./productos-mencionados";

// Filas con la forma EXACTA que devuelven buscar_productos y
// buscar_piezas_usadas en vendedor.ts (solo los campos que importan aquí).
function nueva(codigo: string, extra: Record<string, unknown> = {}) {
  return {
    codigo,
    descripcion: `FASCIA DEL ${codigo}`,
    precioSinIva: 1000,
    precioConIva: 1160,
    entregaInmediata: 2,
    sobrePedido: null,
    usado: null,
    observacion: null,
    ...extra,
  };
}

function usada(idPieza: number, codigo: string, extra: Record<string, unknown> = {}) {
  return {
    idPieza,
    codigo,
    descripcion: `CALAVERA ${codigo}`,
    precioSinIva: 500,
    precioConIva: 580,
    existencia: 1,
    foto: "/api/usadas/foto?n=x.jpg",
    fotoPublica: "https://sistema.apvidaurri.com/imagenes_piezas/x.jpg",
    ...extra,
  };
}

describe("codigoMencionado", () => {
  it("encuentra el código sin importar mayúsculas y entre paréntesis", () => {
    expect(codigoMencionado("Tengo la *Facia Versa* (dddai15) en *$1,798.00*", "DDDAI15")).toBe(true);
  });

  it("no acepta el código como subcadena de otra palabra o código", () => {
    expect(codigoMencionado("Tengo el CNVE15R disponible", "CNVE15")).toBe(false);
    expect(codigoMencionado("Las piezas de la bodega", "AS")).toBe(false);
  });
});

describe("productosMencionados", () => {
  it("mapea nuevas y usadas con existencia, idPieza y la foto de la respuesta", () => {
    const productos = productosMencionados({
      resultadosPorHerramienta: [
        { herramienta: "buscar_productos", resultados: [nueva("DDDAI15", { entregaInmediata: 3 })] },
        { herramienta: "buscar_piezas_usadas", resultados: [usada(77, "CAL-01")] },
      ],
      texto: "Tengo la *Facia Versa* (DDDAI15) y una calavera usada (CAL-01)",
      fotos: [{ codigo: "dddai15", url: "https://x.mx/api/whatsapp/foto/m1/aldo/DDDAI15.jpg" }],
    });

    expect(productos).toEqual([
      {
        origen: "nueva",
        codigo: "DDDAI15",
        idPiezaUsada: null,
        descripcion: "FASCIA DEL DDDAI15",
        precioConIva: 1160,
        existencia: 3,
        foto: "https://x.mx/api/whatsapp/foto/m1/aldo/DDDAI15.jpg",
      },
      {
        origen: "usada",
        codigo: "CAL-01",
        idPiezaUsada: 77,
        descripcion: "CALAVERA CAL-01",
        precioConIva: 580,
        existencia: 1,
        foto: null,
      },
    ]);
  });

  it("pone primero las que Vico mencionó, conserva el orden de consulta y recorta a 8", () => {
    const filas = Array.from({ length: 10 }, (_, i) => nueva(`COD${i}`));
    const productos = productosMencionados({
      resultadosPorHerramienta: [{ herramienta: "buscar_productos", resultados: filas }],
      texto: "Te recomiendo la (COD7) y si no la (COD2).",
      fotos: [],
    });

    expect(productos).toHaveLength(MAX_PRODUCTOS_MENCIONADOS);
    // Dentro de cada grupo se respeta el orden en que las devolvió la búsqueda.
    expect(productos.map((p) => p.codigo)).toEqual([
      "COD2",
      "COD7",
      "COD0",
      "COD1",
      "COD3",
      "COD4",
      "COD5",
      "COD6",
    ]);
  });

  it("no repite una pieza que salió en dos búsquedas del mismo turno", () => {
    const productos = productosMencionados({
      resultadosPorHerramienta: [
        { herramienta: "buscar_productos", resultados: [nueva("A1"), nueva("B2")] },
        { herramienta: "buscar_productos", resultados: [nueva("a1"), nueva("C3")] },
        { herramienta: "buscar_piezas_usadas", resultados: [usada(5, "A1"), usada(5, "A1")] },
      ],
      texto: "",
      fotos: [],
    });

    expect(productos.map((p) => `${p.origen}:${p.codigo}`)).toEqual([
      "nueva:A1",
      "nueva:B2",
      "nueva:C3",
      "usada:A1",
    ]);
  });

  it("ignora filas incompletas, usadas sin idPieza y herramientas que no son búsqueda", () => {
    const productos = productosMencionados({
      resultadosPorHerramienta: [
        {
          herramienta: "buscar_productos",
          resultados: [{ codigo: "SINPRECIO", descripcion: "X" }, "basura", null, nueva("OK1")],
        },
        { herramienta: "buscar_piezas_usadas", resultados: [usada(0, "SINID"), { codigo: "X", descripcion: "Y", precioConIva: 1 }] },
        { herramienta: "listar_marcas", resultados: [{ codigo: "NISSAN", descripcion: "x", precioConIva: 1 }] },
      ],
      texto: "",
      fotos: [],
    });

    expect(productos.map((p) => p.codigo)).toEqual(["OK1"]);
  });

  it("sin entregaInmediata numérica la existencia de una nueva es 0", () => {
    const [producto] = productosMencionados({
      resultadosPorHerramienta: [
        { herramienta: "buscar_productos", resultados: [nueva("Z9", { entregaInmediata: undefined })] },
      ],
      texto: "",
      fotos: [],
    });

    expect(producto.existencia).toBe(0);
  });

  it("sin búsquedas en el turno no devuelve nada", () => {
    expect(productosMencionados({ resultadosPorHerramienta: [], texto: "¿Para qué año?", fotos: [] })).toEqual([]);
  });
});
