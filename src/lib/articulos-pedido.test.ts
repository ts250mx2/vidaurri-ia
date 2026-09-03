import { describe, expect, it } from "vitest";
import {
  depurarDuplicados,
  factorDescuento,
  normalizarDescuento,
  sqlFiltroPrecio,
  sqlPrecioBase,
} from "./articulos-pedido";

describe("normalizarDescuento", () => {
  it("acepta un porcentaje entre 0 y 100 (sin incluir 100)", () => {
    expect(normalizarDescuento(0)).toBe(0);
    expect(normalizarDescuento(15)).toBe(15);
    expect(normalizarDescuento(33.5)).toBe(33.5);
    expect(normalizarDescuento(99.99)).toBe(99.99);
  });

  it("cotiza de mostrador (null) con cualquier otra cosa", () => {
    expect(normalizarDescuento(null)).toBeNull();
    expect(normalizarDescuento(undefined)).toBeNull();
    expect(normalizarDescuento(100)).toBeNull();
    expect(normalizarDescuento(-1)).toBeNull();
    expect(normalizarDescuento(Number.NaN)).toBeNull();
    expect(normalizarDescuento(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("factorDescuento", () => {
  it("convierte el porcentaje en el multiplicador del precio de lista", () => {
    expect(factorDescuento(15)).toBe(0.85);
    expect(factorDescuento(0)).toBe(1);
    expect(factorDescuento(33)).toBe(0.67);
  });
});

describe("sqlPrecioBase", () => {
  it("sin descuento cotiza el precio de mostrador tal cual", () => {
    expect(sqlPrecioBase(null)).toBe("IFNULL(a.precio_vta, 0)");
  });

  it("con descuento recalcula desde lista salvo que sea el mismo del artículo", () => {
    const sql = sqlPrecioBase(15);
    expect(sql).toContain("CASE WHEN a.descuento = 15 THEN IFNULL(a.precio_vta, 0)");
    expect(sql).toContain("ROUND(IFNULL(a.precio_lista, 0) * 0.85, 2)");
  });

  it("interpola el mismo factor que calcula factorDescuento", () => {
    // Mismo cálculo que vendedor.ts: (100 - D) / 100 sin redondear, para que
    // el pedido y el chat canten los mismos centavos.
    expect(sqlPrecioBase(33)).toContain(`* ${(100 - 33) / 100}, 2)`);
  });
});

describe("sqlFiltroPrecio", () => {
  it("sin descuento acepta cualquier precio (lista o mostrador), como buscar_productos de Vico", () => {
    expect(sqlFiltroPrecio(null)).toBe("(IFNULL(a.precio_lista, 0) > 0 OR IFNULL(a.precio_vta, 0) > 0)");
  });

  it("con descuento exige precio de lista, porque de ahí se recalcula", () => {
    expect(sqlFiltroPrecio(15)).toBe("IFNULL(a.precio_lista, 0) > 0");
    expect(sqlFiltroPrecio(0)).toBe("IFNULL(a.precio_lista, 0) > 0");
  });
});

describe("depurarDuplicados", () => {
  const fila = (id: number, codigo: string, existencia: number) => ({ id, codigo, existencia });

  it("deja una fila por código: la de más existencia, luego la de menor id", () => {
    const filas = [fila(5, "ABC", 0), fila(3, "ABC", 2), fila(9, "XYZ", 1), fila(1, "abc", 2)];
    expect(depurarDuplicados(filas)).toEqual([fila(1, "abc", 2), fila(9, "XYZ", 1)]);
  });

  it("conserva el orden de primera aparición de cada código", () => {
    const filas = [fila(2, "B", 0), fila(1, "A", 0), fila(3, "B", 5)];
    expect(depurarDuplicados(filas).map((f) => f.codigo)).toEqual(["B", "A"]);
  });

  it("no toca una lista sin duplicados", () => {
    const filas = [fila(1, "A", 1), fila(2, "B", 0)];
    expect(depurarDuplicados(filas)).toEqual(filas);
  });
});
