import { describe, expect, it } from "vitest";
import { validarSentenciaPos } from "./db-bdav-escritura";
import { ID_CTE_NO_REGISTRADO } from "./pos-cotiza";
import {
  ERROR_SIN_RENGLONES_BKO,
  ID_PROV_ALDO,
  ID_VENDEDOR_DEFAULT,
  SQL_CANCELAR_BKO,
  SQL_FOLIO_BKO,
  SQL_TOMAR_FOLIO_BKO,
  armarBackorderPos,
  detalleInsercionBko,
  leerIdVendedorDefault,
  leerModoBkoPos,
  resumirSimulacionBko,
  sentenciaCabeceraBko,
  sentenciaRenglonBko,
  type ContextoBackorderPos,
  type PartidaParaBackorderPos,
  type PedidoParaBackorderPos,
} from "./pos-backorder";

function partida(
  numero: number,
  codigo: string | null,
  cantidad: number,
  precioUnitario: number,
  extra: Partial<PartidaParaBackorderPos> = {}
): PartidaParaBackorderPos {
  return {
    partida: numero,
    origen: "sobre_pedido",
    codigo,
    cantidad,
    precioUnitario,
    estatusPartida: "sobre_pedido",
    ...extra,
  };
}

/** El pedido de la prueba en vivo del contrato: público general, DDNVE15 ×1
 *  que sí hay (confirmada) y DDNVE15M ×2 sobre pedido a 1,088.08 con IVA. */
const PEDIDO: PedidoParaBackorderPos = {
  id: 41,
  folio: "P-000041",
  cliente: "Público general",
  telefono: null,
  partidas: [
    partida(1, "DDNVE15", 1, 854.92, { origen: "nueva", estatusPartida: "confirmada" }),
    partida(2, "DDNVE15M", 2, 1088.08),
  ],
};

const CONTEXTO: ContextoBackorderPos = {
  idClienteBdav: null,
  idVendedor: 3,
  fechaBko: "2026-09-03",
  fechaCompromiso: "VIERNES",
  idArticuloPorPartida: new Map([
    [1, 5348],
    [2, 19099],
  ]),
};

describe("armarBackorderPos", () => {
  it("arma la cabecera de Aldo y un renglón sin IVA con los totales del POS (DDNVE15M ×2)", () => {
    const armado = armarBackorderPos(PEDIDO, CONTEXTO);

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.backorder.cabecera).toEqual({
      idProv: ID_PROV_ALDO,
      idCte: ID_CTE_NO_REGISTRADO,
      idVendedor: 3,
      fechaBko: "2026-09-03",
      nombreCliente: "Público general",
      telefono: "",
      email: "",
      subtotal: 1876,
      iva: 300.16,
      total: 2176.16,
      anticipo: 0,
      liquida: 0,
      saldo: 2176.16,
      estatus: "ABIERTA",
      fechaCompromiso: "VIERNES",
      comentarios: "Pedido web P-000041",
    });
    expect(armado.backorder.renglones).toEqual([
      { idArt: 19099, partida: 1, cantidad: 2, precio: 938, totalPart: 1876, estatus: "BKO" },
    ]);
    expect(armado.backorder.omitidas).toEqual([]);
  });

  it("reproduce el ejemplo real del contrato (bko 70: subtotal 12449.00, IVA 1991.84, total 14440.84)", () => {
    // Los nueve renglones reales, sin IVA; el pedido los trae con IVA (× 1.16).
    const sinIva = [2800, 2380, 1540, 840, 910, 1120, 192, 1050, 1617];
    const pedido: PedidoParaBackorderPos = {
      ...PEDIDO,
      cliente: "CLIENTES MOSTRADOR",
      partidas: sinIva.map((precio, i) => partida(i + 1, `ART${i + 1}`, 1, Number((precio * 1.16).toFixed(2)))),
    };
    const contexto: ContextoBackorderPos = {
      ...CONTEXTO,
      idArticuloPorPartida: new Map(sinIva.map((_, i) => [i + 1, 1000 + i])),
    };

    const armado = armarBackorderPos(pedido, contexto);

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.backorder.renglones.map((r) => r.precio)).toEqual(sinIva);
    expect(armado.backorder.renglones.map((r) => r.partida)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(armado.backorder.cabecera).toMatchObject({ subtotal: 12449, iva: 1991.84, total: 14440.84, saldo: 14440.84 });
  });

  it("el IVA se calcula sobre el subtotal ya redondeado y subtotal + IVA cuadra con el total", () => {
    // 3 × 99.99 con IVA → precio 86.20, total_part 258.60
    const pedido = { ...PEDIDO, partidas: [partida(1, "A", 3, 99.99)] };
    const armado = armarBackorderPos(pedido, { ...CONTEXTO, idArticuloPorPartida: new Map([[1, 7]]) });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    const { subtotal, iva, total } = armado.backorder.cabecera;
    expect(armado.backorder.renglones[0]).toMatchObject({ precio: 86.2, totalPart: 258.6 });
    expect(subtotal).toBe(258.6);
    expect(iva).toBe(41.38);
    expect(total).toBe(299.98);
    expect(Number((subtotal + iva).toFixed(2))).toBe(total);
  });

  it("usa el cliente de bdav cuando está ligado, y NO REGISTRADO cuando no o es 0", () => {
    const con = armarBackorderPos(PEDIDO, { ...CONTEXTO, idClienteBdav: 959 });
    const cero = armarBackorderPos(PEDIDO, { ...CONTEXTO, idClienteBdav: 0 });
    const sin = armarBackorderPos(PEDIDO, CONTEXTO);

    expect(con.ok && con.backorder.cabecera.idCte).toBe(959);
    expect(cero.ok && cero.backorder.cabecera.idCte).toBe(ID_CTE_NO_REGISTRADO);
    expect(sin.ok && sin.backorder.cabecera.idCte).toBe(ID_CTE_NO_REGISTRADO);
  });

  it("lleva el vendedor y el compromiso del contexto tal cual", () => {
    const armado = armarBackorderPos(PEDIDO, { ...CONTEXTO, idVendedor: 1, fechaCompromiso: "MARTES" });
    expect(armado.ok && armado.backorder.cabecera).toMatchObject({ idVendedor: 1, fechaCompromiso: "MARTES" });
  });

  it("recorta el nombre a 200, deja solo dígitos del teléfono (a lo más 20) y comentarios con el folio", () => {
    const pedido = {
      ...PEDIDO,
      cliente: "N".repeat(250),
      telefono: "+52 (81) 1234-5678 ext 99999999999999",
    };
    const armado = armarBackorderPos(pedido, CONTEXTO);

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.backorder.cabecera.nombreCliente).toHaveLength(200);
    expect(armado.backorder.cabecera.telefono).toBe("52811234567899999999");
    expect(armado.backorder.cabecera.telefono).toHaveLength(20);
    expect(armado.backorder.cabecera.comentarios).toBe("Pedido web P-000041");
  });

  it("sin folio (no debería pasar en un pedido confirmado) lo deriva del id", () => {
    const armado = armarBackorderPos({ ...PEDIDO, folio: null }, CONTEXTO);
    expect(armado.ok && armado.backorder.cabecera.comentarios).toBe("Pedido web P-000041");
  });

  it("solo van las partidas sobre pedido: las confirmadas y las usadas se quedan fuera sin anotarse", () => {
    const pedido = {
      ...PEDIDO,
      partidas: [
        partida(1, null, 1, 500, { origen: "usada", estatusPartida: "pendiente" }),
        partida(2, "DDNVE15", 1, 854.92, { origen: "nueva", estatusPartida: "confirmada" }),
        partida(3, "DDNVE15M", 2, 1088.08),
        partida(4, "X1", 1, 116, { estatusPartida: "pendiente" }),
      ],
    };
    const contexto = {
      ...CONTEXTO,
      idArticuloPorPartida: new Map([
        [2, 5348],
        [3, 19099],
        [4, 888],
      ]),
    };
    const armado = armarBackorderPos(pedido, contexto);

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.backorder.renglones).toEqual([
      { idArt: 19099, partida: 1, cantidad: 2, precio: 938, totalPart: 1876, estatus: "BKO" },
      { idArt: 888, partida: 2, cantidad: 1, precio: 100, totalPart: 100, estatus: "BKO" },
    ]);
    expect(armado.backorder.omitidas).toEqual([]);
    expect(armado.backorder.cabecera.subtotal).toBe(1976);
  });

  it("una partida sobre pedido sin artículo en bdav se omite, se anota y los renglones se renumeran", () => {
    const pedido = {
      ...PEDIDO,
      partidas: [partida(1, "NOEXISTE", 1, 116), partida(2, "DDNVE15M", 2, 1088.08)],
    };
    const armado = armarBackorderPos(pedido, { ...CONTEXTO, idArticuloPorPartida: new Map([[2, 19099]]) });

    expect(armado.ok).toBe(true);
    if (!armado.ok) return;
    expect(armado.backorder.renglones).toEqual([
      { idArt: 19099, partida: 1, cantidad: 2, precio: 938, totalPart: 1876, estatus: "BKO" },
    ]);
    expect(armado.backorder.omitidas).toEqual(["1 × NOEXISTE (sin artículo en bdav)"]);
  });

  it("si no queda ningún renglón (nada sobre pedido o nada resuelto) falla con el mensaje del contrato", () => {
    const sinSobrePedido = {
      ...PEDIDO,
      partidas: [partida(1, "DDNVE15", 1, 854.92, { estatusPartida: "confirmada" })],
    };
    const sinResolver = { ...PEDIDO, partidas: [partida(1, "ZZZ", 1, 500)] };

    expect(armarBackorderPos(sinSobrePedido, CONTEXTO)).toEqual({ ok: false, error: ERROR_SIN_RENGLONES_BKO });
    expect(armarBackorderPos(sinResolver, { ...CONTEXTO, idArticuloPorPartida: new Map() })).toEqual({
      ok: false,
      error: ERROR_SIN_RENGLONES_BKO,
    });
    expect(armarBackorderPos({ ...PEDIDO, partidas: [] }, CONTEXTO)).toEqual({
      ok: false,
      error: ERROR_SIN_RENGLONES_BKO,
    });
    expect(ERROR_SIN_RENGLONES_BKO).toBe("Ninguna partida se puede pedir a Aldo");
  });
});

describe("sentencias del POS para la back order", () => {
  const armado = armarBackorderPos(PEDIDO, CONTEXTO);

  it("cabecera: parámetros en el orden de las columnas, con el num_bko tomado del folio", () => {
    if (!armado.ok) throw new Error("armado inválido");
    const cabecera = sentenciaCabeceraBko(71, armado.backorder.cabecera);
    expect(cabecera.params).toEqual([
      1,
      1,
      3,
      71,
      "2026-09-03",
      "Público general",
      "",
      "",
      1876,
      300.16,
      2176.16,
      0,
      0,
      2176.16,
      "ABIERTA",
      "VIERNES",
      "Pedido web P-000041",
    ]);
    expect(cabecera.sql).toMatch(/^INSERT INTO back_order \(id_prov, id_cte, id_vendedor, num_bko, fecha_bko/);
  });

  it("renglón: id_bko, id_art, partida, cantidad, precio, total_part y estatus; cant_recibida y fecha_llegada van NULL", () => {
    if (!armado.ok) throw new Error("armado inválido");
    const renglon = sentenciaRenglonBko(9001, armado.backorder.renglones[0]);
    expect(renglon.params).toEqual([9001, 19099, 1, 2, 938, 1876, "BKO"]);
    expect(renglon.sql).toContain("NULL, NULL");
  });

  it("todas pasan la lista blanca del pool de escritura tal como se arman", () => {
    if (!armado.ok) throw new Error("armado inválido");
    const sentencias = [
      SQL_FOLIO_BKO,
      SQL_TOMAR_FOLIO_BKO,
      SQL_CANCELAR_BKO,
      sentenciaCabeceraBko(71, armado.backorder.cabecera).sql,
      sentenciaRenglonBko(1, armado.backorder.renglones[0]).sql,
    ];
    for (const sql of sentencias) expect(() => validarSentenciaPos(sql), sql).not.toThrow();
  });

  it("son exactamente las sentencias que autorizó el dueño", () => {
    expect(SQL_FOLIO_BKO).toBe(
      "SELECT id, folio_bko FROM folios_ventas WHERE folio_bko IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE"
    );
    expect(SQL_TOMAR_FOLIO_BKO).toBe("UPDATE folios_ventas SET folio_bko = folio_bko + 1 WHERE id = ? AND folio_bko = ?");
    expect(SQL_CANCELAR_BKO).toBe("UPDATE back_order SET estatus = ? WHERE id = ?");
  });
});

describe("resumirSimulacionBko / detalleInsercionBko", () => {
  it("el resumen de la simulación dice renglones, cliente, vendedor, folio estimado, compromiso y totales", () => {
    const armado = armarBackorderPos(PEDIDO, CONTEXTO);
    if (!armado.ok) throw new Error("armado inválido");
    const resumen = resumirSimulacionBko(armado.backorder, 71);
    expect(resumen).toBe(
      "Simulada (no se escribió en el POS): 1 renglón, id_cte 1, vendedor 3, num_bko estimado 71, compromiso VIERNES, subtotal 1876.00, IVA 300.16, total 2176.16"
    );
    expect(resumen.length).toBeLessThanOrEqual(200);
  });

  it("cuenta las omitidas y nunca pasa de 200 caracteres", () => {
    const pedido = {
      ...PEDIDO,
      partidas: [partida(1, "NOEXISTE", 1, 116), partida(2, "DDNVE15M", 2, 1088.08)],
    };
    const armado = armarBackorderPos(pedido, { ...CONTEXTO, idArticuloPorPartida: new Map([[2, 19099]]) });
    if (!armado.ok) throw new Error("armado inválido");
    const resumen = resumirSimulacionBko(armado.backorder, "?");
    expect(resumen).toMatch(/num_bko estimado \?/);
    expect(resumen).toMatch(/; 1 omitida$/);
    expect(resumen.length).toBeLessThanOrEqual(200);
  });

  it("el detalle del evento en la bitácora lleva el número, los renglones, el total y el compromiso", () => {
    const armado = armarBackorderPos(PEDIDO, CONTEXTO);
    if (!armado.ok) throw new Error("armado inválido");
    expect(detalleInsercionBko(71, armado.backorder)).toBe(
      "Back order 71 en el POS: 1 renglón, total 2,176.16, compromiso VIERNES"
    );
  });
});

describe("leerModoBkoPos / leerIdVendedorDefault", () => {
  it("reconoce los tres modos y cae a simulación con cualquier otra cosa", () => {
    expect(leerModoBkoPos("real")).toBe("real");
    expect(leerModoBkoPos(" Simulacion ")).toBe("simulacion");
    expect(leerModoBkoPos("apagado")).toBe("apagado");
    expect(leerModoBkoPos(undefined)).toBe("simulacion");
    expect(leerModoBkoPos("")).toBe("simulacion");
    expect(leerModoBkoPos("produccion")).toBe("simulacion");
    expect(leerModoBkoPos("REAL ")).toBe("real");
  });

  it("el vendedor por defecto es un entero positivo; si no, JR (3)", () => {
    expect(ID_VENDEDOR_DEFAULT).toBe(3);
    expect(leerIdVendedorDefault("1")).toBe(1);
    expect(leerIdVendedorDefault(" 2 ")).toBe(2);
    expect(leerIdVendedorDefault(undefined)).toBe(3);
    expect(leerIdVendedorDefault("")).toBe(3);
    expect(leerIdVendedorDefault("0")).toBe(3);
    expect(leerIdVendedorDefault("-1")).toBe(3);
    expect(leerIdVendedorDefault("2.5")).toBe(3);
    expect(leerIdVendedorDefault("JR")).toBe(3);
  });
});
