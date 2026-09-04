import { describe, expect, it } from "vitest";
import { validarSentenciaPos } from "./db-bdav-escritura";
import {
  ERROR_SIN_RENGLONES,
  ERROR_TOPE,
  ID_CTE_NO_REGISTRADO,
  SQL_CANCELAR_COTIZA,
  SQL_CONTAR_NUM_COTIZA,
  SQL_ULTIMO_NUM_COTIZA,
  armarCotizacionPos,
  leerModoCotizaPos,
  puedeCotizarEnPos,
  resumirSimulacion,
  sentenciaCabecera,
  sentenciaRenglon,
  type PartidaACotizarPos,
  type PedidoACotizarPos,
} from "./pos-cotiza";

function partida(
  numero: number,
  codigo: string | null,
  cantidad: number,
  precioUnitario: number,
  extra: Partial<PartidaACotizarPos> = {}
): PartidaACotizarPos {
  return {
    partida: numero,
    origen: codigo === null ? "usada" : "nueva",
    codigo,
    idPiezaUsada: codigo === null ? 18639 : null,
    cantidad,
    precioUnitario,
    ...extra,
  };
}

/** Pedido de la prueba en vivo del contrato: público general, DDNVE15 ×2 a 854.92. */
const PEDIDO: PedidoACotizarPos = {
  id: 131,
  folio: "P-000131",
  sucursal: "fierro",
  cliente: "Público general",
  telefono: null,
  partidas: [partida(1, "DDNVE15", 2, 854.92)],
};

const CON_ARTICULOS = new Map([
  [1, 5348],
  [2, 777],
  [3, 888],
]);

describe("armarCotizacionPos", () => {
  it("mapea el pedido a cabecera y renglones con precio sin IVA y totales del POS", () => {
    const armado = armarCotizacionPos(PEDIDO, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.cabecera).toEqual({
      idCte: ID_CTE_NO_REGISTRADO,
      nombre: "Público general",
      telefono: "",
      subtotal: 1474,
      iva: 235.84,
      total: 1709.84,
      observa: "Pedido web P-000131 · recoge en Fierro",
      estatus: "VIGENTE",
    });
    expect(armado.cotizacion.renglones).toEqual([
      { idArticulo: 5348, partida: 1, cantidad: 2, precio: 737, totalPartida: 1474 },
    ]);
    expect(armado.cotizacion.omitidas).toEqual([]);
  });

  it("desglosa el IVA hacia atrás con dos decimales (854.92 → 737.00; 1088.08 → 938.00)", () => {
    const pedido = { ...PEDIDO, partidas: [partida(1, "A", 1, 854.92), partida(2, "B", 1, 1088.08)] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.renglones.map((r) => r.precio)).toEqual([737, 938]);
    expect(armado.cotizacion.cabecera.subtotal).toBe(1675);
    expect(armado.cotizacion.cabecera.iva).toBe(268);
    expect(armado.cotizacion.cabecera.total).toBe(1943);
  });

  it("el IVA se calcula sobre el subtotal ya redondeado y el total cuadra a dos decimales", () => {
    // 3 × 99.99 con IVA → precio 86.20 (99.99 / 1.16 = 86.198…), total_partida 258.60
    const pedido = { ...PEDIDO, partidas: [partida(1, "A", 3, 99.99)] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    const { subtotal, iva, total } = armado.cotizacion.cabecera;
    expect(armado.cotizacion.renglones[0]).toMatchObject({ precio: 86.2, totalPartida: 258.6 });
    expect(subtotal).toBe(258.6);
    expect(iva).toBe(41.38);
    expect(total).toBe(299.98);
    expect(Number((subtotal + iva).toFixed(2))).toBe(total);
  });

  it("usa el cliente de bdav cuando viene, y NO REGISTRADO cuando no o es 0", () => {
    const con = armarCotizacionPos(PEDIDO, { idClienteBdav: 4321, idArticuloPorPartida: CON_ARTICULOS });
    const cero = armarCotizacionPos(PEDIDO, { idClienteBdav: 0, idArticuloPorPartida: CON_ARTICULOS });
    const sin = armarCotizacionPos(PEDIDO, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(con.ok && con.cotizacion.cabecera.idCte).toBe(4321);
    expect(cero.ok && cero.cotizacion.cabecera.idCte).toBe(ID_CTE_NO_REGISTRADO);
    expect(sin.ok && sin.cotizacion.cabecera.idCte).toBe(ID_CTE_NO_REGISTRADO);
  });

  it("omite las usadas, las anota en observa y renumera los renglones que sí van", () => {
    const pedido = {
      ...PEDIDO,
      partidas: [partida(1, null, 1, 500), partida(2, "DDNVE15", 2, 854.92), partida(3, "X1", 1, 116)],
    };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.renglones).toEqual([
      { idArticulo: 777, partida: 1, cantidad: 2, precio: 737, totalPartida: 1474 },
      { idArticulo: 888, partida: 2, cantidad: 1, precio: 100, totalPartida: 100 },
    ]);
    expect(armado.cotizacion.omitidas).toEqual([{ partida: 1, motivo: "usada #18639: el POS no cotiza usadas" }]);
    expect(armado.cotizacion.cabecera.observa).toBe("Pedido web P-000131 · recoge en Fierro +1 usada #18639");
    expect(armado.cotizacion.cabecera.subtotal).toBe(1574);
    expect(armado.cotizacion.cabecera.total).toBe(1825.84);
  });

  it("omite las partidas nuevas sin artículo resuelto en bdav", () => {
    const pedido = { ...PEDIDO, partidas: [partida(1, "DDNVE15", 2, 854.92), partida(2, "NOEXISTE", 1, 116)] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: new Map([[1, 5348]]) });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.renglones).toHaveLength(1);
    expect(armado.cotizacion.omitidas).toEqual([{ partida: 2, motivo: "NOEXISTE: sin artículo en bdav" }]);
    expect(armado.cotizacion.cabecera.observa).toContain("+1 NOEXISTE (sin artículo)");
  });

  it("las partidas sobre pedido sí se cotizan", () => {
    const pedido = { ...PEDIDO, partidas: [partida(1, "DDNVE15", 1, 854.92, { origen: "sobre_pedido" })] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.renglones).toHaveLength(1);
  });

  it("falla si no queda ningún renglón (solo usadas o nada resuelto)", () => {
    const soloUsadas = { ...PEDIDO, partidas: [partida(1, null, 1, 500)] };
    const sinResolver = { ...PEDIDO, partidas: [partida(1, "ZZZ", 1, 500)] };

    expect(armarCotizacionPos(soloUsadas, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS })).toEqual({
      ok: false,
      error: ERROR_SIN_RENGLONES,
    });
    expect(armarCotizacionPos(sinResolver, { idClienteBdav: null, idArticuloPorPartida: new Map() })).toEqual({
      ok: false,
      error: ERROR_SIN_RENGLONES,
    });
    expect(armarCotizacionPos({ ...PEDIDO, partidas: [] }, { idClienteBdav: null, idArticuloPorPartida: new Map() })).toEqual({
      ok: false,
      error: ERROR_SIN_RENGLONES,
    });
  });

  it("falla si el total rebasa el tope float(7,2) del POS", () => {
    // 99 × 1,170.88 con IVA → 99 × 1,009.38 = 99,928.62 sin IVA → total 115,917.20
    const pedido = { ...PEDIDO, partidas: [partida(1, "DDNVE15", 99, 1170.88)] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });
    expect(armado).toEqual({ ok: false, error: ERROR_TOPE });

    // Justo debajo del tope sí pasa: 1 × 99,999.99 con IVA → 86,206.89 + 13,793.10 = 99,999.99
    const alFilo = { ...PEDIDO, partidas: [partida(1, "DDNVE15", 1, 99999.99)] };
    const ok = armarCotizacionPos(alFilo, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });
    expect(ok.ok && ok.cotizacion.cabecera.total).toBe(99999.99);
  });

  it("acota nombre, teléfono y observa a las columnas del POS", () => {
    const pedido = {
      ...PEDIDO,
      folio: null,
      cliente: "N".repeat(150),
      telefono: "1".repeat(40),
      sucursal: "matriz" as const,
      partidas: [partida(1, "DDNVE15", 1, 854.92), ...Array.from({ length: 6 }, (_, i) => partida(i + 2, null, 1, 100))],
    };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.cotizacion.cabecera.nombre).toHaveLength(100);
    expect(armado.cotizacion.cabecera.telefono).toHaveLength(30);
    expect(armado.cotizacion.cabecera.observa.startsWith("Pedido web P-000131 · recoge en Matriz +1 usada #18639")).toBe(true);
    expect(armado.cotizacion.cabecera.observa.length).toBeLessThanOrEqual(100);
    expect(armado.cotizacion.omitidas).toHaveLength(6);
  });
});

describe("sentencias del POS", () => {
  const cotizacion = armarCotizacionPos(PEDIDO, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });

  it("arman el INSERT de cabecera y renglón con los parámetros en el orden de las columnas", () => {
    if (!cotizacion.ok) throw new Error("armado inválido");
    const cabecera = sentenciaCabecera(cotizacion.cotizacion.cabecera, 166446, "2026-09-03");
    expect(cabecera.params).toEqual([1, 166446, "Público general", "", "2026-09-03", 1474, 235.84, 1709.84, "Pedido web P-000131 · recoge en Fierro"]);
    expect(cabecera.sql).toContain("'VIGENTE'");

    const renglon = sentenciaRenglon(9001, cotizacion.cotizacion.renglones[0]);
    expect(renglon.params).toEqual([9001, 5348, 1, 2, 737, 1474]);
  });

  it("todas pasan la lista blanca del pool de escritura tal como se arman", () => {
    if (!cotizacion.ok) throw new Error("armado inválido");
    const sentencias = [
      SQL_ULTIMO_NUM_COTIZA,
      SQL_CONTAR_NUM_COTIZA,
      SQL_CANCELAR_COTIZA,
      sentenciaCabecera(cotizacion.cotizacion.cabecera, 1, "2026-09-03").sql,
      sentenciaRenglon(1, cotizacion.cotizacion.renglones[0]).sql,
    ];
    for (const sql of sentencias) expect(() => validarSentenciaPos(sql), sql).not.toThrow();
  });
});

describe("resumirSimulacion", () => {
  it("dice cuántos renglones y los totales, en ≤ 200 caracteres", () => {
    const armado = armarCotizacionPos(PEDIDO, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });
    if (!armado.ok) throw new Error("armado inválido");
    const resumen = resumirSimulacion(armado.cotizacion);
    expect(resumen).toBe(
      "Simulada (no se escribió en el POS): 1 renglón, id_cte 1, subtotal 1474.00, IVA 235.84, total 1709.84"
    );
    expect(resumen.length).toBeLessThanOrEqual(200);
  });

  it("cuenta las omitidas", () => {
    const pedido = { ...PEDIDO, partidas: [partida(1, null, 1, 500), partida(2, "DDNVE15", 2, 854.92)] };
    const armado = armarCotizacionPos(pedido, { idClienteBdav: null, idArticuloPorPartida: CON_ARTICULOS });
    if (!armado.ok) throw new Error("armado inválido");
    expect(resumirSimulacion(armado.cotizacion)).toMatch(/; 1 omitida$/);
  });
});

describe("leerModoCotizaPos / puedeCotizarEnPos", () => {
  it("reconoce los tres modos y cae a simulación con cualquier otra cosa", () => {
    expect(leerModoCotizaPos("real")).toBe("real");
    expect(leerModoCotizaPos(" Simulacion ")).toBe("simulacion");
    expect(leerModoCotizaPos("apagado")).toBe("apagado");
    expect(leerModoCotizaPos(undefined)).toBe("simulacion");
    expect(leerModoCotizaPos("")).toBe("simulacion");
    expect(leerModoCotizaPos("produccion")).toBe("simulacion");
    expect(leerModoCotizaPos("REAL ")).toBe("real");
  });

  it("solo se cotiza en el POS un pedido listo o entregado", () => {
    expect(puedeCotizarEnPos("listo")).toBe(true);
    expect(puedeCotizarEnPos("entregado")).toBe(true);
    for (const e of ["borrador", "enviado", "confirmado", "cancelado"] as const) expect(puedeCotizarEnPos(e)).toBe(false);
  });
});
