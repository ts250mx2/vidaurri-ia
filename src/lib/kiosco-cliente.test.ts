import { describe, expect, it } from "vitest";
import type { ClienteDescuento } from "./clientes-descuento";
import type { PedidoDeCliente } from "./db-pedidos";
import {
  LIMITE_ENTRADAS_KIOSCO,
  PEDIDOS_CLIENTE_KIOSCO,
  datosClienteParaEnvio,
  detalleParaCliente,
  esBorradorDelCliente,
  pedidoParaCliente,
} from "./kiosco-cliente";
import { crearCupo } from "./kiosco-api";
import type { PartidaPedido, PedidoDetalle } from "./pedidos";

// Lo que el cliente que entró con su celular puede ver de sí mismo y de sus
// pedidos en la pantalla del piso. Se prueba por lo que NO sale: nada que
// identifique internamente al pedido, nada del POS, nada del padrón que no
// haga falta para saludarlo y cotizar.

const CLIENTE: ClienteDescuento = {
  id: 4,
  telefono: "8112345678",
  telefonos: ["8112345678", "8187654321"],
  cliente: "Taller López",
  descuento: 38,
  rfc: "LOPJ800101XX1",
  telefono2: "83226730 - 83549915",
  email: "taller@lopez.mx",
  idClienteApv: 77,
  idClienteBdav: 501,
  permitirPedido: false,
  creadoPor: "ruben",
  creadoEn: "2026-09-01 10:00:00",
  actualizadoPor: "ruben",
  actualizadoEn: "2026-09-02 10:00:00",
};

const PARTIDA: PartidaPedido = {
  id: 10,
  partida: 1,
  origen: "nueva",
  codigo: "FAC123",
  idPiezaUsada: null,
  descripcion: "FASCIA DEL VERSA 15-19",
  cantidad: 2,
  precioUnitario: 674.61,
  importe: 1349.22,
  existenciaAlPedir: 7,
  estatusPartida: "confirmada",
  diasEntrega: null,
  cantidadAldo: 1,
  nota: "apartada para el 3",
  foto: null,
};

const PEDIDO = {
  id: 131,
  folio: "P-000131",
  estatus: "confirmado",
  canal: "kiosco",
  idCliente: 4,
  idClienteBdav: 501,
  cliente: "Taller López",
  telefono: "8112345678",
  descuentoPct: 38,
  sucursal: "fierro",
  capturadoPor: null,
  atendidoPor: "jperez",
  subtotal: 1163.12,
  iva: 186.1,
  total: 1349.22,
  numPartidas: 1,
  numCotizaPos: 9001,
  cotizaPosEstado: "insertada",
  cotizaPosError: null,
  numBkoPos: 7001,
  bkoPosEstado: "insertada",
  bkoPosError: "detalle del POS",
  bkoPosCompromiso: "MARTES",
  domicilio: null,
  creadoEn: "2026-09-15 10:00:00",
  enviadoEn: "2026-09-15 10:05:00",
  confirmadoEn: "2026-09-15 10:30:00",
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-15 10:30:00",
  observaciones: "Recoge en la tarde",
  folioVentaPos: "V-55",
  motivoCancelacion: "cliente moroso",
  partidas: [PARTIDA],
  eventos: [
    {
      id: 1,
      evento: "creado",
      estatusAnterior: null,
      estatusNuevo: "borrador",
      detalle: "Cliente #4 · Taller López",
      usuario: "kiosco",
      canal: "kiosco",
      creadoEn: "2026-09-15 10:00:00",
    },
  ],
} satisfies PedidoDetalle;

/** Lo que jamás debe salir hacia la pantalla del piso. */
const SECRETOS = [
  '"id":131',
  "9001",
  "7001",
  "jperez",
  "eventos",
  "cotizaPos",
  "bkoPos",
  "detalle del POS",
  "V-55",
  "cliente moroso",
  "existenciaAlPedir",
  "apartada para el 3",
  "cantidadAldo",
  "idClienteBdav",
  "descuentoPct",
];

describe("pedidoParaCliente", () => {
  const fila: PedidoDeCliente = { ...PEDIDO, piezas: 2 };

  it("un renglón de 'Mis pedidos': folio, estatus, fechas, total con IVA, piezas y sucursal", () => {
    expect(pedidoParaCliente(fila)).toEqual({
      folio: "P-000131",
      estatus: "confirmado",
      creadoEn: "2026-09-15 10:00:00",
      enviadoEn: "2026-09-15 10:05:00",
      total: 1349.22,
      piezas: 2,
      sucursal: "fierro",
    });
  });

  it("no trae el id interno, la bitácora, el POS ni quién lo atendió", () => {
    const crudo = JSON.stringify(pedidoParaCliente(fila));

    for (const secreto of SECRETOS) expect(crudo, secreto).not.toContain(secreto);
  });
});

describe("detalleParaCliente", () => {
  it("la cabecera más los renglones y las observaciones de su hoja; las piezas se suman de los renglones", () => {
    const detalle = detalleParaCliente({ ...PEDIDO, partidas: [PARTIDA, { ...PARTIDA, id: 11, partida: 2, cantidad: 3 }] });

    expect(detalle).toEqual({
      folio: "P-000131",
      estatus: "confirmado",
      creadoEn: "2026-09-15 10:00:00",
      enviadoEn: "2026-09-15 10:05:00",
      total: 1349.22,
      piezas: 5,
      sucursal: "fierro",
      observaciones: "Recoge en la tarde",
      partidas: [
        {
          descripcion: "FASCIA DEL VERSA 15-19",
          codigo: "FAC123",
          cantidad: 2,
          precioUnitario: 674.61,
          importe: 1349.22,
          estatusPartida: "confirmada",
        },
        {
          descripcion: "FASCIA DEL VERSA 15-19",
          codigo: "FAC123",
          cantidad: 3,
          precioUnitario: 674.61,
          importe: 1349.22,
          estatusPartida: "confirmada",
        },
      ],
    });
  });

  it("no trae ids de partida, existencias, notas internas, POS ni motivo de cancelación", () => {
    const crudo = JSON.stringify(detalleParaCliente(PEDIDO));

    for (const secreto of [...SECRETOS, '"id":10', "idPartida", "diasEntrega", "motivoCancelacion"]) {
      expect(crudo, secreto).not.toContain(secreto);
    }
  });
});

describe("esBorradorDelCliente", () => {
  it("sin sesión solo cuenta el borrador anónimo; con sesión solo el que nació con su id", () => {
    expect(esBorradorDelCliente({ idCliente: null }, null)).toBe(true);
    expect(esBorradorDelCliente({ idCliente: 4 }, null)).toBe(false);
    expect(esBorradorDelCliente({ idCliente: 4 }, CLIENTE)).toBe(true);
    expect(esBorradorDelCliente({ idCliente: null }, CLIENTE)).toBe(false);
    expect(esBorradorDelCliente({ idCliente: 9 }, CLIENTE)).toBe(false);
  });
});

describe("datosClienteParaEnvio", () => {
  it("con sesión el pedido se sella con el padrón e IGNORA lo que traiga el cuerpo", () => {
    const resultado = datosClienteParaEnvio(CLIENTE, { nombre: "Otro Nombre", telefono: "8100000000" });

    expect(resultado).toEqual({ ok: true, datos: { cliente: "Taller López", telefono: "8112345678" } });
  });

  it("con sesión ni siquiera hace falta cuerpo", () => {
    expect(datosClienteParaEnvio(CLIENTE, {})).toMatchObject({ ok: true });
    expect(datosClienteParaEnvio(CLIENTE, null)).toMatchObject({ ok: true });
    expect(datosClienteParaEnvio(CLIENTE, "basura")).toMatchObject({ ok: true });
  });

  it("un cliente del padrón sin celular principal se sella sin celular, no con uno tecleado", () => {
    const sinCelular = { ...CLIENTE, telefono: null, telefonos: [] };

    expect(datosClienteParaEnvio(sinCelular, { nombre: "X", telefono: "8100000000" })).toEqual({
      ok: true,
      datos: { cliente: "Taller López", telefono: null },
    });
  });

  it("sin sesión valida lo tecleado exactamente como la pantalla de datos", () => {
    expect(datosClienteParaEnvio(null, { nombre: "  Juan   Pérez ", telefono: "+52 81 1234 5678" })).toEqual({
      ok: true,
      datos: { cliente: "Juan Pérez", telefono: "8112345678" },
    });
    expect(datosClienteParaEnvio(null, { nombre: "Juan Pérez", telefono: "123" })).toEqual({
      ok: false,
      error: "Escribe tu celular a 10 dígitos",
    });
    expect(datosClienteParaEnvio(null, {})).toMatchObject({ ok: false });
  });
});

describe("tope de intentos de entrar", () => {
  it("10 por aparato cada 10 minutos, con el mismo cupo que el resto del kiosco", () => {
    expect(LIMITE_ENTRADAS_KIOSCO).toEqual({ maximo: 10, ventanaMs: 10 * 60 * 1000 });
    expect(PEDIDOS_CLIENTE_KIOSCO).toBe(20);

    const cupo = crearCupo(LIMITE_ENTRADAS_KIOSCO);
    const t0 = 1_000_000;
    for (let intento = 0; intento < 10; intento++) {
      expect(cupo.intentar("piso-1", t0 + intento)).toBe(true);
    }
    expect(cupo.intentar("piso-1", t0 + 10)).toBe(false);
    // Otro aparato no paga por el barrido de este.
    expect(cupo.intentar("piso-2", t0 + 10)).toBe(true);
    // Pasados los 10 minutos vuelve a haber cupo.
    expect(cupo.intentar("piso-1", t0 + 10 * 60 * 1000 + 1)).toBe(true);
  });
});
