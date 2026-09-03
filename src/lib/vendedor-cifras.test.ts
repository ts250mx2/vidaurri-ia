import { describe, expect, it } from "vitest";
import { catalogoVacio, cifrasInventadas, registrarResultado } from "./vendedor-cifras";

describe("registrarResultado con resultados de búsqueda", () => {
  it("apunta códigos y descripciones en mayúsculas y precios redondeados", () => {
    const catalogo = catalogoVacio();
    const contenido = JSON.stringify({
      resultados: [
        { codigo: "dddai15", descripcion: "Facia Versa 15-19 ald265", precioConIva: 1798.004, precioSinIva: 1550 },
        { codigo: "GTCAE18R", descripcion: "Calavera Aveo", precioConIva: "2,001", usado: { desdeConIva: 850.5 } },
      ],
    });

    registrarResultado(contenido, catalogo);

    expect(catalogo.codigos).toEqual(new Set(["DDDAI15", "GTCAE18R"]));
    expect(catalogo.descripciones).toEqual(["FACIA VERSA 15-19 ALD265", "CALAVERA AVEO"]);
    // "2,001" no es número: se ignora sin tronar; 1798.004 se redondea a centavos.
    expect(catalogo.precios).toEqual(new Set([1798, 1550, 850.5]));
  });

  it("ignora filas sin código, precios no positivos y no numéricos", () => {
    const catalogo = catalogoVacio();
    const contenido = JSON.stringify({
      resultados: [
        { codigo: "", descripcion: "Sin código", precioConIva: 0, precioSinIva: -5 },
        { codigo: 123, precioConIva: "no", usado: null },
      ],
    });

    registrarResultado(contenido, catalogo);

    expect(catalogo.codigos.size).toBe(0);
    expect(catalogo.descripciones).toEqual(["SIN CÓDIGO"]);
    expect(catalogo.precios.size).toBe(0);
  });
});

describe("registrarResultado con folios e importes de pedido", () => {
  it("registra los folios como códigos en mayúsculas y los importes como precios", () => {
    const catalogo = catalogoVacio();
    const contenido = JSON.stringify({
      pedido: { folio: "P-000131", estatus: "enviado" },
      resultados: [{ codigo: "DDDAI15", descripcion: "Facia Versa", precioConIva: 1798, cantidad: 2, importe: 3596 }],
      folios: ["p-000131"],
      importes: [5050, 808, 5858.004, 3596],
    });

    registrarResultado(contenido, catalogo);

    expect(catalogo.codigos).toEqual(new Set(["DDDAI15", "P-000131"]));
    expect(catalogo.precios).toEqual(new Set([1798, 5050, 808, 5858, 3596]));
  });

  it("solo toma folios que sean texto e importes finitos mayores a cero", () => {
    const catalogo = catalogoVacio();
    const contenido = JSON.stringify({
      folios: ["P-000132", "", null, 7],
      importes: [0, -1, "abc", null, 12.345, 1e999],
    });

    registrarResultado(contenido, catalogo);

    expect(catalogo.codigos).toEqual(new Set(["P-000132"]));
    // 1e999 serializa como null; 12.345 se queda en centavos.
    expect(catalogo.precios).toEqual(new Set([12.35]));
  });

  it("no truena si folios o importes no vienen como lista", () => {
    const catalogo = catalogoVacio();

    expect(() => registrarResultado(JSON.stringify({ folios: "P-000131", importes: 5858 }), catalogo)).not.toThrow();

    expect(catalogo.codigos.size).toBe(0);
    expect(catalogo.precios.size).toBe(0);
  });

  it("el folio citado en la respuesta no se marca inventado tras registrarlo", () => {
    const catalogo = catalogoVacio();
    const respuesta = "Listo, tu pedido P-000131 quedó enviado. Recógelo en Matriz.";
    // Control: sin registrarlo, el folio sí parece un código inventado.
    registrarResultado(JSON.stringify({ resultados: [{ codigo: "DDDAI15" }] }), catalogo);
    expect(cifrasInventadas(respuesta, catalogo).codigos).toEqual(["P-000131"]);

    registrarResultado(JSON.stringify({ folios: ["P-000131"], importes: [] }), catalogo);

    expect(cifrasInventadas(respuesta, catalogo).codigos).toEqual([]);
  });

  it("el total registrado en importes pasa aunque se escriba con comas y centavos", () => {
    const catalogo = catalogoVacio();
    const respuesta = "El total es $5,858.00 IVA incluido (subtotal $5,050.00 + IVA $808.00).";
    // Control: con catálogo de un solo precio ajeno, los tres importes se marcan.
    registrarResultado(JSON.stringify({ resultados: [{ codigo: "X", precioConIva: 1 }] }), catalogo);
    expect(cifrasInventadas(respuesta, catalogo).precios).toEqual(["$5,858.00", "$5,050.00", "$808.00"]);

    registrarResultado(JSON.stringify({ folios: [], importes: [5050, 808, 5858] }), catalogo);

    expect(cifrasInventadas(respuesta, catalogo).precios).toEqual([]);
  });
});

describe("registrarResultado con contenido que no es JSON de objeto", () => {
  it("no truena con JSON inválido y deja el catálogo intacto", () => {
    const catalogo = catalogoVacio();

    expect(() => registrarResultado("esto no es json {", catalogo)).not.toThrow();
    expect(() => registrarResultado("", catalogo)).not.toThrow();

    expect(catalogo.codigos.size).toBe(0);
    expect(catalogo.descripciones).toEqual([]);
    expect(catalogo.precios.size).toBe(0);
  });

  it("no truena con JSON válido que no es objeto", () => {
    const catalogo = catalogoVacio();

    expect(() => registrarResultado("null", catalogo)).not.toThrow();
    expect(() => registrarResultado("42", catalogo)).not.toThrow();
    expect(() => registrarResultado('"texto"', catalogo)).not.toThrow();

    expect(catalogo.codigos.size).toBe(0);
    expect(catalogo.precios.size).toBe(0);
  });
});
