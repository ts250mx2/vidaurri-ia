import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAX,
  OBSERVACIONES_MAX,
  calcularTotales,
  errorCantidadUsada,
  errorConfirmacionPartida,
  esEstatusPedido,
  esSucursal,
  fechaCompromisoAldo,
  firmaBackorder,
  folioDeId,
  partidasAMarcarSobrePedido,
  partidasParaBackorder,
  partidaVuelveAPendiente,
  perfilDe,
  POR_PAGINA_PEDIDOS,
  puedeCambiarEstatus,
  puedeCancelarCliente,
  puedeEditarPedido,
  puedeFijarDescuento,
  puedeTenerBackorder,
  renglonesParaBackorder,
  validarAperturaBorrador,
  validarCambioEstatus,
  validarCantidad,
  validarDatosClienteKiosco,
  validarEnvioBorrador,
  validarCapturaPartida,
  validarConfirmacionPartidas,
  validarFiltrosPedidos,
  validarObservaciones,
  validarSucursal,
  type EstatusPedido,
  type PartidaPedido,
  type PerfilPos,
  type RenglonAldo,
  CANALES_PEDIDO,
  NOMBRE_KIOSCO_MAX,
  NOMBRE_KIOSCO_MIN,
  esCanalPedido,
} from "./pedidos";

const PERFILES: PerfilPos[] = ["Administrador", "Operaciones", "Ventas"];
const ESTATUS: EstatusPedido[] = ["borrador", "enviado", "confirmado", "listo", "entregado", "cancelado"];

/** Renglón de pedido con todo en su valor más simple; lo que importa va en `extra`. */
function partida(numero: number, extra: Partial<PartidaPedido> = {}): PartidaPedido {
  return {
    id: numero,
    partida: numero,
    origen: "nueva",
    codigo: `C${numero}`,
    idPiezaUsada: null,
    descripcion: `Pieza ${numero}`,
    cantidad: 1,
    precioUnitario: 116,
    importe: 116,
    existenciaAlPedir: null,
    estatusPartida: "pendiente",
    diasEntrega: null,
    cantidadAldo: null,
    nota: null,
    ...extra,
  };
}

describe("partidasParaBackorder", () => {
  it("toma las que el mostrador marcó sobre pedido al confirmar", () => {
    const marcada = partida(1, { origen: "sobre_pedido", estatusPartida: "sobre_pedido", diasEntrega: 3 });
    expect(partidasParaBackorder([partida(2, { estatusPartida: "confirmada" }), marcada])).toEqual([marcada]);
  });

  it("toma las que ya venían sobre pedido y siguen pendientes (nadie dijo que sí hay en tienda)", () => {
    const pendiente = partida(1, { origen: "sobre_pedido", estatusPartida: "pendiente" });
    expect(partidasParaBackorder([pendiente])).toEqual([pendiente]);
  });

  it("toma la nueva pendiente cuya existencia al pedir no alcanzaba (vista optimista)", () => {
    const faltaba = partida(1, { cantidad: 3, existenciaAlPedir: 1 });
    const alcanzaba = partida(2, { cantidad: 3, existenciaAlPedir: 3 });
    expect(partidasParaBackorder([faltaba, alcanzaba])).toEqual([faltaba]);
  });

  it("nunca usadas, confirmadas ni sin existencia; una nueva pendiente con existencia tampoco", () => {
    const fuera = [
      partida(1, { origen: "usada", codigo: null, idPiezaUsada: 18639, estatusPartida: "pendiente" }),
      partida(2, { origen: "usada", codigo: null, idPiezaUsada: 18640, estatusPartida: "confirmada" }),
      partida(3, { origen: "sobre_pedido", estatusPartida: "confirmada" }),
      partida(4, { origen: "sobre_pedido", estatusPartida: "sin_existencia" }),
      partida(5, { origen: "nueva", estatusPartida: "pendiente" }),
      partida(6, { origen: "nueva", estatusPartida: "sin_existencia" }),
      partida(7, { origen: "usada", codigo: null, idPiezaUsada: 18641, cantidad: 2, existenciaAlPedir: 1 }),
    ];
    expect(partidasParaBackorder(fuera)).toEqual([]);
  });

  it("conserva el orden del pedido y no toca la lista original", () => {
    const a = partida(3, { origen: "sobre_pedido", estatusPartida: "sobre_pedido" });
    const b = partida(1, { origen: "sobre_pedido", estatusPartida: "pendiente" });
    const original = [a, partida(2), b];
    expect(partidasParaBackorder(original)).toEqual([a, b]);
    expect(original).toHaveLength(3);
  });
});

describe("firmaBackorder", () => {
  /** Renglón ya calculado, tal como sale de renglonesParaBackorder. */
  const renglon = (numero: number, codigo: string | null, cantidad: number): RenglonAldo => ({
    partida: numero,
    codigo,
    cantidad,
  });

  it("'CODIGO×cant|CODIGO×cant' en orden de partida, aunque lleguen desordenados", () => {
    expect(firmaBackorder([renglon(2, "DDNVE15M", 2), renglon(1, "FAC123", 1)])).toBe("FAC123×1|DDNVE15M×2");
  });

  it("firma la cantidad que va a Aldo, no la del pedido; sin renglones es ''", () => {
    const pendiente = partida(1, { codigo: "FAC123", cantidad: 3 });
    expect(firmaBackorder(renglonesParaBackorder([pendiente], new Map([[1, 1]])))).toBe("FAC123×2");
    expect(firmaBackorder(renglonesParaBackorder([pendiente], new Map([[1, 3]])))).toBe("");
    expect(firmaBackorder([])).toBe("");
  });

  it("cambia si cambia la cantidad o el código, y normaliza el código a mayúsculas", () => {
    const base = renglon(1, "ddnve15m", 2);
    expect(firmaBackorder([base])).toBe("DDNVE15M×2");
    expect(firmaBackorder([{ ...base, cantidad: 3 }])).not.toBe(firmaBackorder([base]));
    expect(firmaBackorder([{ ...base, codigo: "DDNVE15" }])).not.toBe(firmaBackorder([base]));
  });
});

describe("fechaCompromisoAldo", () => {
  it("lunes → MARTES", () => {
    expect(fechaCompromisoAldo("2026-08-31")).toBe("MARTES");
  });

  it("martes, miércoles y jueves → VIERNES (el camión del martes ya no alcanza)", () => {
    expect(fechaCompromisoAldo("2026-09-01")).toBe("VIERNES");
    expect(fechaCompromisoAldo("2026-09-02")).toBe("VIERNES");
    expect(fechaCompromisoAldo("2026-09-03")).toBe("VIERNES");
  });

  it("viernes, sábado y domingo → MARTES", () => {
    expect(fechaCompromisoAldo("2026-09-04")).toBe("MARTES");
    expect(fechaCompromisoAldo("2026-09-05")).toBe("MARTES");
    expect(fechaCompromisoAldo("2026-09-06")).toBe("MARTES");
  });

  it("una fecha mal formada o inexistente lanza, en vez de prometer un día al azar", () => {
    expect(() => fechaCompromisoAldo("hoy")).toThrow(/fecha/i);
    expect(() => fechaCompromisoAldo("")).toThrow(/fecha/i);
    expect(() => fechaCompromisoAldo("2026-02-30")).toThrow(/fecha/i);
    expect(() => fechaCompromisoAldo("2026-09-03 10:00:00")).toThrow(/fecha/i);
  });
});

describe("puedeTenerBackorder", () => {
  it("desde que el mostrador lo confirma: confirmado, listo o entregado", () => {
    expect(puedeTenerBackorder("confirmado")).toBe(true);
    expect(puedeTenerBackorder("listo")).toBe(true);
    expect(puedeTenerBackorder("entregado")).toBe(true);
  });

  it("antes de confirmar o ya cancelado, no", () => {
    for (const e of ["borrador", "enviado", "cancelado"] as const) expect(puedeTenerBackorder(e), e).toBe(false);
  });
});

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

describe("puedeEditarPedido", () => {
  it("se edita mientras el mostrador no lo haya surtido, sin importar el perfil", () => {
    expect(puedeEditarPedido("borrador")).toBe(true);
    expect(puedeEditarPedido("enviado")).toBe(true);
    expect(puedeEditarPedido("confirmado")).toBe(true);
  });

  it("listo, entregado y cancelado ya no cambian", () => {
    for (const e of ["listo", "entregado", "cancelado"] as const) {
      expect(puedeEditarPedido(e), e).toBe(false);
    }
  });
});

describe("partidaVuelveAPendiente", () => {
  it("en un pedido confirmado cualquier renglón tocado vuelve a pendiente", () => {
    for (const ep of ["pendiente", "confirmada", "sin_existencia", "sobre_pedido"] as const) {
      expect(partidaVuelveAPendiente("confirmado", ep), ep).toBe(true);
    }
  });

  it("en un pedido enviado solo si el mostrador ya lo había revisado", () => {
    expect(partidaVuelveAPendiente("enviado", "pendiente")).toBe(false);
    expect(partidaVuelveAPendiente("enviado", "confirmada")).toBe(true);
    expect(partidaVuelveAPendiente("enviado", "sin_existencia")).toBe(true);
    expect(partidaVuelveAPendiente("enviado", "sobre_pedido")).toBe(true);
  });

  it("en un borrador nunca: nadie lo ha revisado", () => {
    expect(partidaVuelveAPendiente("borrador", "pendiente")).toBe(false);
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
  it("porPagina: número acotado a 10..1000, 'todos' = 1000, basura = 50", () => {
    expect(validarFiltrosPedidos({ porPagina: "25" }).porPagina).toBe(25);
    expect(validarFiltrosPedidos({ porPagina: "todos" }).porPagina).toBe(1000);
    expect(validarFiltrosPedidos({ porPagina: "TODOS" }).porPagina).toBe(1000);
    expect(validarFiltrosPedidos({ porPagina: "5" }).porPagina).toBe(10);
    expect(validarFiltrosPedidos({ porPagina: "5000" }).porPagina).toBe(1000);
    expect(validarFiltrosPedidos({ porPagina: "abc" }).porPagina).toBe(50);
    expect(validarFiltrosPedidos({ porPagina: "" }).porPagina).toBe(50);
  });

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

  it("backorder: solo 'si' filtra; cualquier otra cosa se ignora", () => {
    expect(validarFiltrosPedidos({ backorder: "si" })).toEqual({
      backorder: "si",
      pagina: 1,
      porPagina: POR_PAGINA_PEDIDOS,
    });
    for (const crudo of ["", "no", "sí", "SI", "1", "true", undefined]) {
      expect(validarFiltrosPedidos({ backorder: crudo }).backorder, String(crudo)).toBeUndefined();
    }
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

describe("validarCantidad", () => {
  it("acepta un entero entre 1 y el tope, como número o como cadena de dígitos", () => {
    expect(validarCantidad({ cantidad: 3 })).toEqual({ ok: true, datos: { cantidad: 3 } });
    expect(validarCantidad({ cantidad: "12" })).toEqual({ ok: true, datos: { cantidad: 12 } });
    expect(validarCantidad({ cantidad: " 1 " })).toEqual({ ok: true, datos: { cantidad: 1 } });
    expect(validarCantidad({ cantidad: CANTIDAD_MAX })).toEqual({ ok: true, datos: { cantidad: CANTIDAD_MAX } });
  });

  it("rechaza cero, negativos, decimales, el tope rebasado y lo que no es número", () => {
    const error = `La cantidad debe ser un entero entre 1 y ${CANTIDAD_MAX}`;
    for (const cantidad of [0, -1, 1.5, CANTIDAD_MAX + 1, "0", "012", "1e3", "abc", "", null, undefined, true]) {
      expect(validarCantidad({ cantidad }), String(cantidad)).toEqual({ ok: false, error });
    }
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(validarCantidad(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarCantidad(3)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarCantidad([3])).toEqual({ ok: false, error: "Petición inválida" });
  });
});

describe("validarObservaciones", () => {
  it("limpia el texto; vacío o ausente queda en null (las borra)", () => {
    expect(validarObservaciones({ observaciones: "  lo recoge \t su hijo " })).toEqual({
      ok: true,
      datos: { observaciones: "lo recoge su hijo" },
    });
    expect(validarObservaciones({ observaciones: "" })).toEqual({ ok: true, datos: { observaciones: null } });
    expect(validarObservaciones({ observaciones: "   " })).toEqual({ ok: true, datos: { observaciones: null } });
    expect(validarObservaciones({ observaciones: null })).toEqual({ ok: true, datos: { observaciones: null } });
    expect(validarObservaciones({})).toEqual({ ok: true, datos: { observaciones: null } });
  });

  it("acota el largo y rechaza cuerpos que no son objetos", () => {
    expect(validarObservaciones({ observaciones: "x".repeat(OBSERVACIONES_MAX) }).ok).toBe(true);
    expect(validarObservaciones({ observaciones: "x".repeat(OBSERVACIONES_MAX + 1) })).toEqual({
      ok: false,
      error: `Las observaciones no pueden pasar de ${OBSERVACIONES_MAX} caracteres`,
    });
    expect(validarObservaciones("hola")).toEqual({ ok: false, error: "Petición inválida" });
  });
});

describe("validarSucursal", () => {
  it("acepta las sucursales del catálogo", () => {
    expect(validarSucursal({ sucursal: "matriz" })).toEqual({ ok: true, datos: { sucursal: "matriz" } });
    expect(validarSucursal({ sucursal: "fierro" })).toEqual({ ok: true, datos: { sucursal: "fierro" } });
  });

  it("la sucursal es obligatoria y tiene que existir tal cual", () => {
    for (const sucursal of [undefined, null, "", "Matriz", "centro", 1]) {
      expect(validarSucursal({ sucursal }), String(sucursal)).toEqual({ ok: false, error: "Sucursal inválida" });
    }
    expect(validarSucursal(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarSucursal("matriz")).toEqual({ ok: false, error: "Petición inválida" });
  });
});

describe("renglonesParaBackorder", () => {
  /** Existencias por número de partida, como las lee bdav al confirmar. */
  const existencias = (pares: Array<[number, number | null]>) => new Map<number, number | null>(pares);

  it("lo que el mostrador marcó a mano sobre pedido va completo, sin mirar la existencia", () => {
    const marcada = partida(1, { codigo: "DDNVE15M", cantidad: 3, origen: "sobre_pedido", estatusPartida: "sobre_pedido" });
    expect(renglonesParaBackorder([marcada], existencias([[1, 2]]))).toEqual([
      { partida: 1, codigo: "DDNVE15M", cantidad: 3 },
    ]);
  });

  it("lo que marcó el sistema va con la cantidad guardada, no con la del pedido", () => {
    const delSistema = partida(1, {
      codigo: "DDNVE15M",
      cantidad: 3,
      origen: "sobre_pedido",
      estatusPartida: "sobre_pedido",
      cantidadAldo: 2,
    });
    expect(renglonesParaBackorder([delSistema], existencias([[1, 1]]))).toEqual([
      { partida: 1, codigo: "DDNVE15M", cantidad: 2 },
    ]);
  });

  it("el segundo intento pide lo mismo que el primero: la back order no cambia sola", () => {
    // Piden 3, hay 1: el primer sync manda 2 y marca el renglón con esa cantidad.
    const antes = partida(1, { codigo: "FAC123", cantidad: 3 });
    const hayUna = existencias([[1, 1]]);
    const primero = renglonesParaBackorder([antes], hayUna);
    expect(primero).toEqual([{ partida: 1, codigo: "FAC123", cantidad: 2 }]);

    // Así queda el renglón en la base tras marcarlo (marcarSobrePedidoPorFaltante).
    const despues = partida(1, {
      codigo: "FAC123",
      cantidad: 3,
      origen: "sobre_pedido",
      estatusPartida: "sobre_pedido",
      cantidadAldo: 2,
    });
    const segundo = renglonesParaBackorder([despues], hayUna);
    expect(segundo).toEqual(primero);
    expect(firmaBackorder(segundo)).toBe(firmaBackorder(primero));
  });

  it("un pendiente cuya existencia actual no alcanza va por el faltante: piden 3, hay 1, van 2", () => {
    const pendiente = partida(1, { codigo: "FAC123", cantidad: 3 });
    expect(renglonesParaBackorder([pendiente], existencias([[1, 1]]))).toEqual([
      { partida: 1, codigo: "FAC123", cantidad: 2 },
    ]);
  });

  it("nunca las usadas, ni lo confirmado, ni lo que el mostrador dijo que no se consigue", () => {
    const fuera = [
      partida(1, { origen: "usada", codigo: null, idPiezaUsada: 18639, cantidad: 2 }),
      partida(2, { origen: "usada", codigo: null, idPiezaUsada: 18640, estatusPartida: "sobre_pedido" }),
      partida(3, { cantidad: 3, estatusPartida: "confirmada" }),
      partida(4, { cantidad: 3, estatusPartida: "sin_existencia" }),
      partida(5, { origen: "sobre_pedido", cantidad: 3, estatusPartida: "confirmada" }),
    ];
    const todas = existencias([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    expect(renglonesParaBackorder(fuera, todas)).toEqual([]);
  });

  it("la existencia que alcanza no pide nada; la negativa (descuadre del POS) cuenta como cero", () => {
    const tres = partida(1, { codigo: "A", cantidad: 3 });
    expect(renglonesParaBackorder([tres], existencias([[1, 3]]))).toEqual([]);
    expect(renglonesParaBackorder([tres], existencias([[1, 9]]))).toEqual([]);
    expect(renglonesParaBackorder([tres], existencias([[1, -4]]))).toEqual([
      { partida: 1, codigo: "A", cantidad: 3 },
    ]);
  });

  it("existencia que no se pudo leer (null o ausente): no se deduce, el renglón se queda como estaba", () => {
    const nueva = partida(1, { codigo: "A", cantidad: 3 });
    const yaSobrePedido = partida(2, { codigo: "B", cantidad: 3, origen: "sobre_pedido" });
    const conNull = existencias([
      [1, null],
      [2, null],
    ]);
    // La nueva pendiente no se pide (nadie ha dicho que falte); la que ya venía
    // sobre pedido sigue yendo completa, como antes de leer existencias.
    const esperado = [{ partida: 2, codigo: "B", cantidad: 3 }];
    expect(renglonesParaBackorder([nueva, yaSobrePedido], conNull)).toEqual(esperado);
    expect(renglonesParaBackorder([nueva, yaSobrePedido], existencias([]))).toEqual(esperado);
  });

  it("conserva el orden del pedido y no toca la lista original", () => {
    const original = [
      partida(3, { codigo: "C", cantidad: 2 }),
      partida(1, { codigo: "A", cantidad: 1, estatusPartida: "confirmada" }),
      partida(2, { codigo: "B", cantidad: 5 }),
    ];
    const resultado = renglonesParaBackorder(
      original,
      existencias([
        [1, 0],
        [2, 1],
        [3, 0],
      ])
    );
    expect(resultado).toEqual([
      { partida: 3, codigo: "C", cantidad: 2 },
      { partida: 2, codigo: "B", cantidad: 4 },
    ]);
    expect(original).toHaveLength(3);
  });
});

describe("partidasAMarcarSobrePedido", () => {
  const existencias = (pares: Array<[number, number | null]>) => new Map<number, number | null>(pares);

  it("solo los pendientes que el faltante manda a Aldo, en orden de partida", () => {
    const partidas = [
      partida(1, { cantidad: 3 }),
      partida(2, { cantidad: 1, origen: "sobre_pedido" }),
      partida(3, { cantidad: 2 }),
    ];
    expect(
      partidasAMarcarSobrePedido(
        partidas,
        existencias([
          [1, 1],
          [2, 0],
          [3, 5],
        ])
      )
    ).toEqual([1, 2]);
  });

  it("no toca lo que el mostrador ya decidió, ni las usadas, ni lo que no se pudo leer", () => {
    const partidas = [
      partida(1, { cantidad: 3, estatusPartida: "sobre_pedido" }),
      partida(2, { cantidad: 3, estatusPartida: "confirmada" }),
      partida(3, { cantidad: 3, estatusPartida: "sin_existencia" }),
      partida(4, { cantidad: 3, origen: "usada", codigo: null, idPiezaUsada: 18639 }),
      partida(5, { cantidad: 3 }),
    ];
    const todas = existencias([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, null],
    ]);
    expect(partidasAMarcarSobrePedido(partidas, todas)).toEqual([]);
  });
});

describe("canal kiosco", () => {
  it("es un canal de pedido más, sin quitar los que ya había", () => {
    expect(CANALES_PEDIDO).toEqual(["mostrador", "whatsapp", "web", "kiosco"]);
    expect(esCanalPedido("kiosco")).toBe(true);
    expect(esCanalPedido("piso")).toBe(false);
  });
});

describe("validarDatosClienteKiosco", () => {
  it("acepta nombre y celular y los devuelve normalizados", () => {
    // Arrange / Act
    const resultado = validarDatosClienteKiosco({ nombre: "  Juan   Pérez ", telefono: "+52 81 1234 5678" });

    // Assert
    expect(resultado).toEqual({ ok: true, datos: { nombre: "Juan Pérez", telefono: "8112345678" } });
  });

  it("normaliza las formas con que la gente escribe su celular", () => {
    for (const crudo of ["8112345678", "81-1234-5678", "044 81 1234 5678", "5218112345678"]) {
      expect(validarDatosClienteKiosco({ nombre: "Ana", telefono: crudo })).toMatchObject({
        ok: true,
        datos: { telefono: "8112345678" },
      });
    }
  });

  it("rechaza un nombre corto, vacío o pasado de largo", () => {
    const corto = "a".repeat(NOMBRE_KIOSCO_MIN - 1);
    const largo = "a".repeat(NOMBRE_KIOSCO_MAX + 1);
    for (const nombre of ["", "  ", corto, largo]) {
      expect(validarDatosClienteKiosco({ nombre, telefono: "8112345678" })).toMatchObject({ ok: false });
    }
    expect(validarDatosClienteKiosco({ nombre: "a".repeat(NOMBRE_KIOSCO_MAX), telefono: "8112345678" })).toMatchObject({
      ok: true,
    });
  });

  it("no deja pasar caracteres invisibles como si fueran nombre", () => {
    expect(validarDatosClienteKiosco({ nombre: "​​​", telefono: "8112345678" })).toMatchObject({
      ok: false,
    });
  });

  it("rechaza un celular que no quede en 10 dígitos", () => {
    for (const telefono of ["", "811234567", "81123456789", "letras", "+1 415 555 0101"]) {
      expect(validarDatosClienteKiosco({ nombre: "Juan Pérez", telefono })).toMatchObject({ ok: false });
    }
  });

  it("un cuerpo que no es objeto no pasa", () => {
    expect(validarDatosClienteKiosco("hola")).toMatchObject({ ok: false });
    expect(validarDatosClienteKiosco([])).toMatchObject({ ok: false });
    expect(validarDatosClienteKiosco(null)).toMatchObject({ ok: false });
  });
});
