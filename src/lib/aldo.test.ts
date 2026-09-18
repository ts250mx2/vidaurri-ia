import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buscarAldo, disponibleAldo, precioAldo, reiniciarAldo } from "./aldo";

// Renglones tal como los devuelve hoy pi_resultados.jsp ya aplanados (18-sep-2026):
// tras los dos precios vienen la Existencia y el siguiente reparto ("Viernes").
const TABLA_REAL = `<table><tr><td>Existencia</td><td>Viernes</td><td>Cantidad</td></tr>
<tr><td>CNVE12</td><td>COFRE VERSA 12-14 582 28909 1480.09DFZ</td><td>$2,200.00 $2,552.00</td><td>Mas de 60 0</td></tr>
<tr><td colspan="8">Costados, Lienzos de Costado y Estribos</td></tr>
<tr><td>TCNVE12</td><td>TAPA CAJUELA VERSA 12-19 ALD261 452</td><td>$2,800.00 $3,248.00</td><td>Mas de 60 Mas de 60</td></tr>
<tr><td>CNVE15</td><td>XX0828COFRE VERSA 15-19/ V-DRIVE 20-25 ALD261</td><td>$2,200.00 $2,552.00</td><td>0.00 Mas de 60</td></tr>
<tr><td>22602650</td><td>SENSOR OXIGENO VERSA 12-19</td><td>$900.00 $1,044.00</td><td>0.00 0</td></tr>
<tr><td>CNVE20</td><td>COFRE VERSA 20-25 ALD261 TYG</td><td>$2,700.00 $3,132.00</td><td>19.00 0</td></tr></table>`;

function tablaReal(): Response {
  return new Response(TABLA_REAL, { status: 200 });
}

const MINUTO = 60_000;

/** HTML aplanable como el de pi_resultados.jsp: código, descripción, $ sin IVA, $ con IVA, existencia. */
function paginaDe(codigo: string, existencia = "12"): Response {
  const html = `<table><tr><td>Cantidad</td></tr><tr><td>${codigo}</td><td>COFRE VERSA 15-19</td><td>$1,474.00</td><td>$1,709.84</td><td>${existencia}</td></tr></table>`;
  return new Response(html, { status: 200 });
}

function redCaida(): never {
  throw new TypeError("fetch failed");
}

beforeEach(() => {
  reiniciarAldo();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("precioAldo", () => {
  it("trae precio y existencia del sitio y los cachea por código", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => paginaDe("CNVE15"));

    const primero = await precioAldo("cnve15", { fetch: pedir });
    const segundo = await precioAldo("CNVE15", { fetch: pedir });

    expect(primero).toMatchObject({ encontrado: true, sinIva: 1474, conIva: 1709.84, existencia: 12 });
    expect(segundo).toEqual(primero);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("un código que el sitio no trae es 'no encontrado', no 'sin respuesta'", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => paginaDe("OTRO99"));

    const valor = await precioAldo("CNVE15", { fetch: pedir });

    expect(valor).toEqual({ encontrado: false });
  });

  it("si la red falla contesta sinRespuesta y no lo cachea", async () => {
    const pedir = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => redCaida())
      .mockImplementationOnce(async () => paginaDe("CNVE15"));

    const caido = await precioAldo("CNVE15", { fetch: pedir });
    const despues = await precioAldo("CNVE15", { fetch: pedir });

    expect(caido).toEqual({ encontrado: false, sinRespuesta: true });
    expect(despues.encontrado).toBe(true);
  });
});

describe("cortacircuito", () => {
  it("tras dos fallos seguidos deja de consultar el sitio y contesta al instante", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => redCaida());

    await precioAldo("A1", { fetch: pedir });
    await precioAldo("A2", { fetch: pedir });
    const cortados = await Promise.all(["A3", "A4", "A5"].map((c) => precioAldo(c, { fetch: pedir })));

    expect(pedir).toHaveBeenCalledTimes(2);
    expect(cortados).toEqual(Array(3).fill({ encontrado: false, sinRespuesta: true }));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no contesta"));
  });

  it("una búsqueda de cinco códigos con Aldo mudo solo paga los que iban en vuelo", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => redCaida());

    const valores = await Promise.all(["B1", "B2", "B3", "B4", "B5"].map((c) => precioAldo(c, { fetch: pedir })));

    // Concurrencia 4: el quinto esperaba turno y ya encontró el circuito abierto.
    expect(pedir).toHaveBeenCalledTimes(4);
    expect(valores.every((v) => v.sinRespuesta === true)).toBe(true);
  });

  it("vencida la pausa deja pasar una sola consulta de prueba; si contesta, se reanuda", async () => {
    let ahora = 0;
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => redCaida());
    await precioAldo("C1", { fetch: pedir, ahora: () => ahora });
    await precioAldo("C2", { fetch: pedir, ahora: () => ahora });

    ahora = 2 * MINUTO + 1;
    pedir.mockImplementation(async (_url, init) => paginaDe(String(init?.body).replace("codigo=", "")));
    const prueba = await precioAldo("C3", { fetch: pedir, ahora: () => ahora });
    const siguiente = await precioAldo("C4", { fetch: pedir, ahora: () => ahora });

    expect(prueba.encontrado).toBe(true);
    expect(siguiente.encontrado).toBe(true);
    expect(pedir).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("volvió a contestar"));
  });

  it("si la consulta de prueba también falla, se vuelve a pausar", async () => {
    let ahora = 0;
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => redCaida());
    await precioAldo("D1", { fetch: pedir, ahora: () => ahora });
    await precioAldo("D2", { fetch: pedir, ahora: () => ahora });

    ahora = 2 * MINUTO + 1;
    await precioAldo("D3", { fetch: pedir, ahora: () => ahora });
    await precioAldo("D4", { fetch: pedir, ahora: () => ahora });

    // D3 fue la prueba (falló); D4 ya no tocó la red.
    expect(pedir).toHaveBeenCalledTimes(3);
  });

  it("un fallo aislado entre consultas buenas no abre el circuito", async () => {
    const pedir = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => redCaida())
      .mockImplementation(async (_url, init) => paginaDe(String(init?.body).replace("codigo=", "")));

    await precioAldo("E1", { fetch: pedir });
    await precioAldo("E2", { fetch: pedir });
    await precioAldo("E3", { fetch: pedir });
    const valor = await precioAldo("E4", { fetch: pedir });

    expect(valor.encontrado).toBe(true);
    expect(pedir).toHaveBeenCalledTimes(4);
  });
});

describe("existencia y siguiente reparto", () => {
  it("una pieza sin existencia hoy pero con reparto SÍ está disponible: es lo que va sobre pedido", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => tablaReal());

    const valor = await precioAldo("CNVE15", { fetch: pedir });

    expect(valor).toMatchObject({
      encontrado: true,
      sinIva: 2200,
      conIva: 2552,
      existencia: 0,
      proximoReparto: "Mas de 60",
      disponible: "Mas de 60",
    });
  });

  it("con existencia en anaquel, esa es la disponible aunque el reparto venga en 0", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => tablaReal());

    const valor = await precioAldo("CNVE20", { fetch: pedir });

    expect(valor).toMatchObject({ existencia: 19, proximoReparto: 0, disponible: 19 });
  });

  it("sin existencia y sin reparto no hay nada que conseguir", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => tablaReal());

    const valor = await precioAldo("22602650", { fetch: pedir });

    expect(valor).toMatchObject({ encontrado: true, existencia: 0, proximoReparto: 0, disponible: 0 });
  });

  it("si la tabla no trae la columna de reparto, se sigue leyendo la existencia como antes", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => paginaDe("CNVE15", "Mas de 60"));

    const valor = await precioAldo("CNVE15", { fetch: pedir });

    expect(valor).toMatchObject({ existencia: "Mas de 60", disponible: "Mas de 60" });
    expect(valor.proximoReparto).toBeUndefined();
  });

  it("disponibleAldo: la existencia manda; el reparto solo cuenta cuando no hay existencia", () => {
    expect(disponibleAldo("Mas de 60", 0)).toBe("Mas de 60");
    expect(disponibleAldo(0, "Mas de 60")).toBe("Mas de 60");
    expect(disponibleAldo(0, 12)).toBe(12);
    expect(disponibleAldo(0, 0)).toBe(0);
    expect(disponibleAldo(undefined)).toBe(0);
  });

  it("la búsqueda por prefijo lee las dos columnas de cada fila y no confunde un código numérico con una cantidad", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => tablaReal());

    const filas = await buscarAldo("CNVE", { fetch: pedir });

    expect(filas.map((f) => [f.codigo, f.existencia, f.proximoReparto])).toEqual([
      ["CNVE12", "Mas de 60", 0],
      ["TCNVE12", "Mas de 60", "Mas de 60"],
      ["CNVE15", 0, "Mas de 60"],
      ["22602650", 0, 0],
      ["CNVE20", 19, 0],
    ]);
  });
});
