import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAX,
  calcularTotales,
  errorCantidadUsada,
  errorConfirmacionPartida,
  esEstatusPedido,
  esSucursal,
  folioDeId,
  perfilDe,
  POR_PAGINA_PEDIDOS,
  puedeCambiarEstatus,
  puedeCancelarCliente,
  puedeFijarDescuento,
  validarAperturaBorrador,
  validarCambioEstatus,
  validarEnvioBorrador,
  validarCapturaPartida,
  validarConfirmacionPartidas,
  validarFiltrosPedidos,
  type EstatusPedido,
  type PerfilPos,
} from "./pedidos";

const PERFILES: PerfilPos[] = ["Administrador", "Operaciones", "Ventas"];
const ESTATUS: EstatusPedido[] = ["borrador", "enviado", "confirmado", "listo", "entregado", "cancelado"];

describe("folioDeId", () => {
  it("rellena a seis dígitos con el prefijo P-", () => {
    expect(folioDeId(131)).toBe("P-000131");
    expect(folioDeId(1)).toBe("P-000001");
    expect(folioDeId(999999)).toBe("P-999999");
  });

  it("crece sin recortar cuando el id pasa de seis dígitos", () => {
    expect(folioDeId(1234567)).toBe("P-1234567");
  });
});

describe("esEstatusPedido / esSucursal", () => {
  it("reconocen solo los valores del catálogo", () => {
    for (const e of ESTATUS) expect(esEstatusPedido(e)).toBe(true);
    expect(esEstatusPedido("apartado")).toBe(false);
    expect(esEstatusPedido("")).toBe(false);
    expect(esEstatusPedido(null)).toBe(false);
    expect(esEstatusPedido(1)).toBe(false);
    expect(esSucursal("matriz")).toBe(true);
    expect(esSucursal("fierro")).toBe(true);
    expect(esSucursal("Matriz")).toBe(false);
    expect(esSucursal(undefined)).toBe(false);
  });
});

describe("perfilDe", () => {
  it("devuelve el perfil del POS tal cual cuando es conocido", () => {
    for (const perfil of PERFILES) expect(perfilDe({ perfil })).toBe(perfil);
  });

  it("un perfil desconocido o vacío cae a Ventas (mínimo privilegio)", () => {
    expect(perfilDe({ perfil: "Gerente" })).toBe("Ventas");
    expect(perfilDe({ perfil: "administrador" })).toBe("Ventas");
    expect(perfilDe({ perfil: "" })).toBe("Ventas");
  });
});

describe("puedeCambiarEstatus", () => {
  /** La matriz literal del contrato: [de, a, perfiles que pueden]. */
  const PERMITIDAS: Array<[EstatusPedido, EstatusPedido, PerfilPos[]]> = [
    ["enviado", "confirmado", ["Ventas", "Operaciones", "Administrador"]],
    ["confirmado", "listo", ["Ventas", "Operaciones", "Administrador"]],
    ["listo", "entregado", ["Ventas", "Operaciones", "Administrador"]],
    ["enviado", "cancelado", ["Ventas", "Operaciones", "Administrador"]],
    ["confirmado", "cancelado", ["Operaciones", "Administrador"]],
    ["listo", "cancelado", ["Operaciones", "Administrador"]],
  ];

  it("permite cada transición de la matriz a los perfiles que dice el contrato", () => {
    for (const [de, a, perfiles] of PERMITIDAS) {
      for (const perfil of perfiles) {
        expect(puedeCambiarEstatus(perfil, de, a), `${perfil}: ${de} -> ${a}`).toBe(true);
      }
    }
  });

  it("Ventas no puede cancelar lo que el mostrador ya confirmó o surtió", () => {
    expect(puedeCambiarEstatus("Ventas", "confirmado", "cancelado")).toBe(false);
    expect(puedeCambiarEstatus("Ventas", "listo", "cancelado")).toBe(false);
  });

  it("borrador -> enviado no pasa por la matriz: lo hace quien captura", () => {
    for (const perfil of PERFILES) expect(puedeCambiarEstatus(perfil, "borrador", "enviado")).toBe(false);
  });

  it("entregado y cancelado son finales para todos", () => {
    for (const perfil of PERFILES) {
      for (const a of ESTATUS) {
        expect(puedeCambiarEstatus(perfil, "entregado", a), `${perfil}: entregado -> ${a}`).toBe(false);
        expect(puedeCambiarEstatus(perfil, "cancelado", a), `${perfil}: cancelado -> ${a}`).toBe(false);
      }
    }
  });

  it("niega todo lo que no esté en la matriz, incluidos saltos y retrocesos", () => {
    const permitidas = new Set(PERMITIDAS.map(([de, a]) => `${de}>${a}`));
    for (const perfil of PERFILES) {
      for (const de of ESTATUS) {
        for (const a of ESTATUS) {
          if (permitidas.has(`${de}>${a}`)) continue;
          expect(puedeCambiarEstatus(perfil, de, a), `${perfil}: ${de} -> ${a}`).toBe(false);
        }
      }
    }
    // Un par de las negadas, con nombre, para que el fallo se lea de un vistazo.
    expect(puedeCambiarEstatus("Administrador", "enviado", "listo")).toBe(false);
    expect(puedeCambiarEstatus("Administrador", "enviado", "entregado")).toBe(false);
    expect(puedeCambiarEstatus("Administrador", "confirmado", "enviado")).toBe(false);
    expect(puedeCambiarEstatus("Administrador", "listo", "confirmado")).toBe(false);
    expect(puedeCambiarEstatus("Administrador", "enviado", "enviado")).toBe(false);
  });
});

describe("puedeCancelarCliente", () => {
  it("solo mientras el mostrador no lo ha trabajado", () => {
    expect(puedeCancelarCliente("borrador")).toBe(true);
    expect(puedeCancelarCliente("enviado")).toBe(true);
    for (const e of ["confirmado", "listo", "entregado", "cancelado"] as const) {
      expect(puedeCancelarCliente(e)).toBe(false);
    }
  });
});

describe("puedeFijarDescuento", () => {
  it("solo los supervisores fijan el descuento del alta rápida; Ventas no", () => {
    expect(puedeFijarDescuento("Administrador")).toBe(true);
    expect(puedeFijarDescuento("Operaciones")).toBe(true);
    expect(puedeFijarDescuento("Ventas")).toBe(false);
  });
});

describe("errorCantidadUsada", () => {
  it("una pieza usada cabe mientras la cantidad acumulada no rebase la existencia", () => {
    expect(errorCantidadUsada(1, 1)).toBeNull();
    expect(errorCantidadUsada(3, 3)).toBeNull();
    expect(errorCantidadUsada(3, 2)).toBeNull();
  });

  it("rebasar la existencia devuelve un mensaje legible con el tope", () => {
    expect(errorCantidadUsada(1, 2)).toBe("De esa pieza usada solo hay una: pide a lo más 1");
    expect(errorCantidadUsada(2, 3)).toBe("De esa pieza usada solo hay 2: pide a lo más 2");
  });

  it("sin existencia conocida no acota (la Bodega ya la exigió al cotizar)", () => {
    expect(errorCantidadUsada(null, 99)).toBeNull();
  });
});

describe("errorConfirmacionPartida", () => {
  it("una pieza usada no puede ir sobre pedido", () => {
    expect(errorConfirmacionPartida("usada", "sobre_pedido")).toBe("Una pieza usada no puede ir sobre pedido");
  });

  it("el resto de combinaciones son válidas", () => {
    for (const estatus of ["pendiente", "confirmada", "sin_existencia"] as const) {
      expect(errorConfirmacionPartida("usada", estatus)).toBeNull();
    }
    for (const origen of ["nueva", "sobre_pedido"] as const) {
      expect(errorConfirmacionPartida(origen, "sobre_pedido")).toBeNull();
      expect(errorConfirmacionPartida(origen, "confirmada")).toBeNull();
    }
  });
});

describe("calcularTotales", () => {
  it("sin partidas todo es cero", () => {
    expect(calcularTotales([])).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });

  it("3 × 1890.00: el total es la suma con IVA y el subtotal se desglosa hacia atrás", () => {
    expect(calcularTotales([{ cantidad: 3, precioUnitario: 1890 }])).toEqual({
      subtotal: 4887.93,
      iva: 782.07,
      total: 5670,
    });
  });

  it("1 × 2078.33: redondea a dos decimales y subtotal + iva cuadra con el total", () => {
    const r = calcularTotales([{ cantidad: 1, precioUnitario: 2078.33 }]);
    expect(r).toEqual({ subtotal: 1791.66, iva: 286.67, total: 2078.33 });
    expect(Math.round((r.subtotal + r.iva) * 100) / 100).toBe(r.total);
  });

  it("varias partidas: suma importes ya redondeados, sin ruido binario", () => {
    const r = calcularTotales([
      { cantidad: 3, precioUnitario: 1890 },
      { cantidad: 1, precioUnitario: 2078.33 },
      { cantidad: 2, precioUnitario: 0.1 },
    ]);
    expect(r).toEqual({ subtotal: 6679.77, iva: 1068.76, total: 7748.53 });
    expect(Math.round((r.subtotal + r.iva) * 100) / 100).toBe(r.total);
  });
});

describe("validarCapturaPartida", () => {
  it("una pieza nueva por código: deduce el origen y normaliza el código", () => {
    expect(validarCapturaPartida({ codigo: " fac-123 ", cantidad: 2 })).toEqual({
      ok: true,
      datos: { origen: "nueva", codigo: "FAC-123", idPiezaUsada: null, cantidad: 2 },
    });
  });

  it("una pieza usada por id: deduce el origen", () => {
    expect(validarCapturaPartida({ idPiezaUsada: 4821, cantidad: 1 })).toEqual({
      ok: true,
      datos: { origen: "usada", codigo: null, idPiezaUsada: 4821, cantidad: 1 },
    });
    expect(validarCapturaPartida({ idPiezaUsada: "4821", cantidad: "1" })).toEqual({
      ok: true,
      datos: { origen: "usada", codigo: null, idPiezaUsada: 4821, cantidad: 1 },
    });
  });

  it("acepta el origen explícito cuando corresponde con la referencia", () => {
    const r = validarCapturaPartida({ origen: "sobre_pedido", codigo: "FAC-123", cantidad: 1 });
    expect(r.ok && r.datos.origen).toBe("sobre_pedido");
    expect(validarCapturaPartida({ origen: "usada", idPiezaUsada: 7, cantidad: 1 }).ok).toBe(true);
  });

  it("rechaza un origen que no cuadra con la referencia o que no existe", () => {
    expect(validarCapturaPartida({ origen: "usada", codigo: "FAC-123", cantidad: 1 })).toEqual({
      ok: false,
      error: "El origen no corresponde con la pieza indicada",
    });
    expect(validarCapturaPartida({ origen: "nueva", idPiezaUsada: 7, cantidad: 1 }).ok).toBe(false);
    expect(validarCapturaPartida({ origen: "apartado", codigo: "FAC-123", cantidad: 1 })).toEqual({
      ok: false,
      error: "Origen de la partida inválido",
    });
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(validarCapturaPartida(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarCapturaPartida("x").ok).toBe(false);
    expect(validarCapturaPartida([]).ok).toBe(false);
    expect(validarCapturaPartida(undefined).ok).toBe(false);
  });

  it("exige una sola referencia: código o pieza usada", () => {
    expect(validarCapturaPartida({ codigo: "FAC-123", idPiezaUsada: 7, cantidad: 1 })).toEqual({
      ok: false,
      error: "Indica el código de la pieza nueva o el id de la usada, no ambos",
    });
    expect(validarCapturaPartida({ cantidad: 1 })).toEqual({
      ok: false,
      error: "Indica el código de la pieza nueva o el id de la usada",
    });
    expect(validarCapturaPartida({ codigo: "  ", idPiezaUsada: "", cantidad: 1 }).ok).toBe(false);
  });

  it("un código con espacios dentro o caracteres raros no es un código de bdav", () => {
    const error = "Código de pieza inválido";
    expect(validarCapturaPartida({ codigo: "FAC 123", cantidad: 1 })).toEqual({ ok: false, error });
    expect(validarCapturaPartida({ codigo: "FAC;DROP", cantidad: 1 })).toEqual({ ok: false, error });
    expect(validarCapturaPartida({ codigo: "a".repeat(21), cantidad: 1 })).toEqual({ ok: false, error });
    expect(validarCapturaPartida({ codigo: "a".repeat(20), cantidad: 1 }).ok).toBe(true);
  });

  it("la pieza usada tiene que ser un entero positivo escrito en decimal", () => {
    for (const raro of [0, -1, 1.5, "abc", "012", "1e3", 2 ** 64]) {
      expect(validarCapturaPartida({ idPiezaUsada: raro, cantidad: 1 })).toEqual({
        ok: false,
        error: "Pieza usada inválida",
      });
    }
  });

  it("la cantidad es un entero entre 1 y el tope", () => {
    const error = `La cantidad debe ser un entero entre 1 y ${CANTIDAD_MAX}`;
    for (const rara of [0, 100, 1.5, "tres", "", null, undefined, -2, Number.NaN, "2.5"]) {
      expect(validarCapturaPartida({ codigo: "FAC-123", cantidad: rara }), String(rara)).toEqual({
        ok: false,
        error,
      });
    }
    expect(validarCapturaPartida({ codigo: "FAC-123", cantidad: CANTIDAD_MAX }).ok).toBe(true);
    expect(validarCapturaPartida({ codigo: "FAC-123", cantidad: " 3 " }).ok).toBe(true);
  });
});

describe("validarCambioEstatus", () => {
  it("normaliza motivo y folio de venta; vacíos quedan en null", () => {
    expect(validarCambioEstatus({ estatus: "confirmado" })).toEqual({
      ok: true,
      datos: { estatus: "confirmado", motivo: null, folioVentaPos: null },
    });
    expect(
      validarCambioEstatus({ estatus: "cancelado", motivo: "  Cliente  ya no   la quiere ", folioVentaPos: "" })
    ).toEqual({
      ok: true,
      datos: { estatus: "cancelado", motivo: "Cliente ya no la quiere", folioVentaPos: null },
    });
    expect(validarCambioEstatus({ estatus: "entregado", folioVentaPos: " V-88213 " })).toEqual({
      ok: true,
      datos: { estatus: "entregado", motivo: null, folioVentaPos: "V-88213" },
    });
  });

  it("rechaza cuerpos que no son objetos y estatus fuera del catálogo", () => {
    expect(validarCambioEstatus(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarCambioEstatus([]).ok).toBe(false);
    expect(validarCambioEstatus({ estatus: "apartado" })).toEqual({ ok: false, error: "Estatus inválido" });
    expect(validarCambioEstatus({}).ok).toBe(false);
  });

  it("acota el largo del motivo y del folio de venta", () => {
    expect(validarCambioEstatus({ estatus: "cancelado", motivo: "a".repeat(201) }).ok).toBe(false);
    expect(validarCambioEstatus({ estatus: "cancelado", motivo: "a".repeat(200) }).ok).toBe(true);
    expect(validarCambioEstatus({ estatus: "entregado", folioVentaPos: "1".repeat(21) }).ok).toBe(false);
  });
});

describe("validarConfirmacionPartidas", () => {
  it("normaliza cada renglón; los días solo cuentan sobre pedido", () => {
    expect(
      validarConfirmacionPartidas({
        partidas: [
          { id: 1, estatusPartida: "confirmada", diasEntrega: 5, nota: "  " },
          { id: "2", estatusPartida: "sobre_pedido", diasEntrega: "3", nota: " Llega  el jueves " },
          { id: 3, estatusPartida: "sin_existencia" },
        ],
      })
    ).toEqual({
      ok: true,
      datos: [
        { id: 1, estatusPartida: "confirmada", diasEntrega: null, nota: null },
        { id: 2, estatusPartida: "sobre_pedido", diasEntrega: 3, nota: "Llega el jueves" },
        { id: 3, estatusPartida: "sin_existencia", diasEntrega: null, nota: null },
      ],
    });
  });

  it("sobre pedido sin días es válido (el mostrador puede no saberlo aún)", () => {
    const r = validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "sobre_pedido" }] });
    expect(r.ok && r.datos[0].diasEntrega).toBeNull();
  });

  it("rechaza cuerpos sin lista, listas vacías y listas demasiado largas", () => {
    expect(validarConfirmacionPartidas(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarConfirmacionPartidas({ partidas: "x" }).ok).toBe(false);
    expect(validarConfirmacionPartidas({ partidas: [] })).toEqual({
      ok: false,
      error: "No hay partidas que confirmar",
    });
    const muchas = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, estatusPartida: "confirmada" }));
    expect(validarConfirmacionPartidas({ partidas: muchas }).ok).toBe(false);
  });

  it("dice qué renglón falla y por qué", () => {
    expect(validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "confirmada" }, "x"] })).toEqual({
      ok: false,
      error: "Partida 2: renglón inválido",
    });
    expect(validarConfirmacionPartidas({ partidas: [{ id: 0, estatusPartida: "confirmada" }] })).toEqual({
      ok: false,
      error: "Partida 1: id inválido",
    });
    expect(validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "apartada" }] })).toEqual({
      ok: false,
      error: "Partida 1: estatus inválido",
    });
    expect(
      validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "sobre_pedido", diasEntrega: 0 }] }).ok
    ).toBe(false);
    expect(
      validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "sobre_pedido", diasEntrega: 366 }] })
        .ok
    ).toBe(false);
    expect(
      validarConfirmacionPartidas({ partidas: [{ id: 1, estatusPartida: "confirmada", nota: "a".repeat(201) }] })
        .ok
    ).toBe(false);
  });

  it("no acepta el mismo renglón dos veces", () => {
    expect(
      validarConfirmacionPartidas({
        partidas: [
          { id: 1, estatusPartida: "confirmada" },
          { id: "1", estatusPartida: "sin_existencia" },
        ],
      })
    ).toEqual({ ok: false, error: "Partida 2: id repetido" });
  });
});

describe("validarFiltrosPedidos", () => {
  it("sin querystring: primera página, tamaño fijo y sin filtros", () => {
    expect(validarFiltrosPedidos({})).toEqual({ pagina: 1, porPagina: POR_PAGINA_PEDIDOS });
  });

  it("toma lo que entiende y acota los textos", () => {
    expect(
      validarFiltrosPedidos({
        estatus: "enviado",
        sucursal: "fierro",
        canal: "whatsapp",
        usuario: "  ruben ",
        desde: "2026-09-01",
        hasta: "2026-09-02",
        busqueda: " P-000131 ",
        pagina: "3",
      })
    ).toEqual({
      estatus: "enviado",
      sucursal: "fierro",
      canal: "whatsapp",
      usuario: "ruben",
      desde: "2026-09-01",
      hasta: "2026-09-02",
      busqueda: "P-000131",
      pagina: 3,
      porPagina: POR_PAGINA_PEDIDOS,
    });
    expect(validarFiltrosPedidos({ busqueda: "a".repeat(100) }).busqueda).toHaveLength(80);
  });

  it("ignora lo que no entiende en vez de fallar", () => {
    expect(
      validarFiltrosPedidos({
        estatus: "apartado",
        sucursal: "centro",
        canal: "fax",
        desde: "01/09/2026",
        hasta: "ayer",
        usuario: "   ",
        busqueda: "",
        pagina: "abc",
      })
    ).toEqual({ pagina: 1, porPagina: POR_PAGINA_PEDIDOS });
  });

  it("acota la página y endereza un rango de fechas al revés", () => {
    expect(validarFiltrosPedidos({ pagina: "0" }).pagina).toBe(1);
    expect(validarFiltrosPedidos({ pagina: "-4" }).pagina).toBe(1);
    expect(validarFiltrosPedidos({ pagina: "99999999" }).pagina).toBe(10000);
    const r = validarFiltrosPedidos({ desde: "2026-09-10", hasta: "2026-09-01" });
    expect(r.desde).toBe("2026-09-01");
    expect(r.hasta).toBe("2026-09-10");
    expect(validarFiltrosPedidos({ desde: "2026-09-10" })).toEqual({
      desde: "2026-09-10",
      pagina: 1,
      porPagina: POR_PAGINA_PEDIDOS,
    });
  });
});

describe("validarAperturaBorrador", () => {
  it("acepta cliente del padrón o público general, con o sin sucursal", () => {
    expect(validarAperturaBorrador({ idCliente: 12, sucursal: "fierro" })).toEqual({
      ok: true,
      datos: { idCliente: 12, sucursal: "fierro" },
    });
    expect(validarAperturaBorrador({ idCliente: null })).toEqual({
      ok: true,
      datos: { idCliente: null, sucursal: null },
    });
    expect(validarAperturaBorrador({ idCliente: "7", sucursal: "" })).toEqual({
      ok: true,
      datos: { idCliente: 7, sucursal: null },
    });
  });

  it("rechaza clientes y sucursales que no existen", () => {
    expect(validarAperturaBorrador({ idCliente: 0 })).toEqual({ ok: false, error: "Cliente inválido" });
    expect(validarAperturaBorrador({ idCliente: "abc" })).toEqual({ ok: false, error: "Cliente inválido" });
    expect(validarAperturaBorrador({ idCliente: null, sucursal: "centro" })).toEqual({
      ok: false,
      error: "Sucursal inválida",
    });
    expect(validarAperturaBorrador([])).toEqual({ ok: false, error: "Petición inválida" });
  });
});

describe("validarEnvioBorrador", () => {
  it("el cuerpo vacío o ausente vale: se manda tal cual", () => {
    expect(validarEnvioBorrador({})).toEqual({ ok: true, datos: { observaciones: null, sucursal: null } });
    expect(validarEnvioBorrador(undefined)).toEqual({ ok: true, datos: { observaciones: null, sucursal: null } });
  });

  it("limpia las observaciones y toma la sucursal", () => {
    expect(validarEnvioBorrador({ observaciones: "  lo recoge​  su hijo ", sucursal: "matriz" })).toEqual({
      ok: true,
      datos: { observaciones: "lo recoge su hijo", sucursal: "matriz" },
    });
  });

  it("acota las observaciones y rechaza sucursales desconocidas", () => {
    expect(validarEnvioBorrador({ observaciones: "x".repeat(501) }).ok).toBe(false);
    expect(validarEnvioBorrador({ sucursal: "bodega" })).toEqual({ ok: false, error: "Sucursal inválida" });
    expect(validarEnvioBorrador("hola")).toEqual({ ok: false, error: "Petición inválida" });
  });
});
