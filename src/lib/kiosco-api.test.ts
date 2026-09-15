import { describe, expect, it } from "vitest";
import {
  LIMITE_ENVIOS_KIOSCO,
  LIMITE_VICO_KIOSCO,
  acuseParaKiosco,
  actorCapturaKiosco,
  actorVicoKiosco,
  articuloParaKiosco,
  crearCupo,
  pedidoParaKiosco,
  productoParaKiosco,
} from "./kiosco-api";
import type { PartidaPedido, PedidoDetalle } from "./pedidos";

// Lo que el kiosco puede ver. El aparato está en el piso, sin sesión y sin
// nadie vigilándolo: todo lo que estas funciones dejen pasar lo puede leer
// quien se pare enfrente. Por eso se prueba por lo que NO sale.

const PARTIDA: PartidaPedido = {
  id: 10,
  partida: 1,
  origen: "nueva",
  codigo: "FAC123",
  idPiezaUsada: null,
  descripcion: "FASCIA DEL VERSA 15-19",
  cantidad: 2,
  precioUnitario: 1088.08,
  importe: 2176.16,
  existenciaAlPedir: 7,
  estatusPartida: "pendiente",
  diasEntrega: null,
  cantidadAldo: null,
  nota: "apartada para el 3",
};

const PEDIDO = {
  id: 41,
  folio: null,
  estatus: "borrador",
  canal: "kiosco",
  idCliente: null,
  idClienteBdav: null,
  cliente: "Público general",
  telefono: null,
  descuentoPct: 0,
  sucursal: "matriz",
  capturadoPor: null,
  atendidoPor: null,
  subtotal: 1876.0,
  iva: 300.16,
  total: 2176.16,
  numPartidas: 1,
  numCotizaPos: 9001,
  cotizaPosEstado: "insertada",
  cotizaPosError: null,
  numBkoPos: null,
  bkoPosEstado: "pendiente",
  bkoPosError: null,
  bkoPosCompromiso: null,
  creadoEn: "2026-09-15 10:00:00",
  enviadoEn: null,
  confirmadoEn: null,
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-15 10:00:00",
  observaciones: "nota interna",
  folioVentaPos: null,
  motivoCancelacion: null,
  partidas: [PARTIDA],
  eventos: [
    {
      id: 1,
      evento: "creado",
      estatusAnterior: null,
      estatusNuevo: "borrador",
      detalle: "Público general",
      usuario: "kiosco",
      canal: "kiosco",
      creadoEn: "2026-09-15 10:00:00",
    },
  ],
} satisfies PedidoDetalle;

describe("pedidoParaKiosco", () => {
  it("devuelve solo lo que la pantalla necesita para pintar el pedido", () => {
    const vista = pedidoParaKiosco(PEDIDO);

    expect(vista).toEqual({
      piezas: 2,
      total: 2176.16,
      partidas: [
        {
          idPartida: 10,
          origen: "nueva",
          codigo: "FAC123",
          idPiezaUsada: null,
          descripcion: "FASCIA DEL VERSA 15-19",
          cantidad: 2,
          precioConIva: 1088.08,
          importe: 2176.16,
          hayEnTienda: true,
        },
      ],
    });
  });

  it("no filtra el id del pedido, la bitácora, el POS ni la existencia exacta", () => {
    const crudo = JSON.stringify(pedidoParaKiosco(PEDIDO));

    for (const secreto of ["9001", "eventos", "cotizaPos", "existenciaAlPedir", "nota interna", "capturadoPor"]) {
      expect(crudo).not.toContain(secreto);
    }
  });

  it("marca sobre pedido lo que no alcanza, y suma las piezas de todos los renglones", () => {
    const vista = pedidoParaKiosco({
      ...PEDIDO,
      partidas: [
        { ...PARTIDA, existenciaAlPedir: 1 },
        { ...PARTIDA, id: 11, partida: 2, codigo: "COF999", cantidad: 3, existenciaAlPedir: null },
      ],
    });

    expect(vista?.piezas).toBe(5);
    expect(vista?.partidas.map((p) => p.hayEnTienda)).toEqual([false, false]);
  });

  it("sin borrador no hay nada que pintar", () => {
    expect(pedidoParaKiosco(null)).toBeNull();
  });
});

describe("acuseParaKiosco", () => {
  it("el acuse del envío es folio, piezas y total y nada más", () => {
    const enviado: PedidoDetalle = { ...PEDIDO, estatus: "enviado", folio: "P-000131", cliente: "Juan Pérez", telefono: "8112345678" };

    const acuse = acuseParaKiosco(enviado);

    expect(acuse).toEqual({ folio: "P-000131", piezas: 2, total: 2176.16 });
    expect(JSON.stringify(acuse)).not.toContain("8112345678");
  });
});

describe("articuloParaKiosco", () => {
  it("cambia la existencia exacta por un sí/no y no deja pasar el costo ni la localización", () => {
    const articulo = articuloParaKiosco({
      codigo: "FAC123",
      descripcion: "FASCIA DEL VERSA 15-19",
      existencia: 7,
      precioConIva: 1088.08,
      precioSinIva: 938.0,
      marca: "NISSAN",
      tipoParte: "DEFENSAS DELANTERAS",
    });

    expect(articulo).toEqual({
      codigo: "FAC123",
      descripcion: "FASCIA DEL VERSA 15-19",
      precioConIva: 1088.08,
      hayEnTienda: true,
      marca: "NISSAN",
      tipoParte: "DEFENSAS DELANTERAS",
    });
    expect(JSON.stringify(articulo)).not.toContain("938");
    expect(JSON.stringify(articulo)).not.toContain("7");
  });

  it("sin existencia es sobre pedido", () => {
    const articulo = articuloParaKiosco({
      codigo: "X",
      descripcion: "Y",
      existencia: 0,
      precioConIva: 10,
      precioSinIva: 8.62,
      marca: "",
      tipoParte: "",
    });
    expect(articulo.hayEnTienda).toBe(false);
  });
});

describe("productoParaKiosco", () => {
  it("lo que Vico menciona sale con foto y sin existencia exacta", () => {
    const producto = productoParaKiosco({
      origen: "usada",
      codigo: "PU-18639",
      idPiezaUsada: 18639,
      descripcion: "Puerta delantera izquierda",
      precioConIva: 1500,
      existencia: 1,
      foto: "/api/usadas/foto?n=abc.jpg",
    });

    expect(producto).toEqual({
      origen: "usada",
      codigo: "PU-18639",
      idPiezaUsada: 18639,
      descripcion: "Puerta delantera izquierda",
      precioConIva: 1500,
      hayEnTienda: true,
      foto: "/api/usadas/foto?n=abc.jpg",
    });
  });
});

describe("actores del kiosco", () => {
  it("el borrador es del aparato y el pedido nace sin descuento ni vendedor", () => {
    expect(actorCapturaKiosco({ kiosco: "piso-1", sucursal: "fierro" })).toEqual({
      tipo: "kiosco",
      kiosco: "piso-1",
    });
    expect(actorVicoKiosco({ kiosco: "piso-1", sucursal: "fierro" })).toEqual({
      tipo: "kiosco",
      kiosco: "piso-1",
      sucursal: "fierro",
    });
  });
});

describe("crearCupo", () => {
  it("deja pasar hasta el tope y luego frena, dentro de la ventana", () => {
    const cupo = crearCupo({ maximo: 3, ventanaMs: 60_000 });
    const t0 = 1_000_000;

    expect(cupo.intentar("piso-1", t0)).toBe(true);
    expect(cupo.intentar("piso-1", t0 + 1)).toBe(true);
    expect(cupo.intentar("piso-1", t0 + 2)).toBe(true);
    expect(cupo.intentar("piso-1", t0 + 3)).toBe(false);
  });

  it("cada kiosco lleva su propia cuenta", () => {
    const cupo = crearCupo({ maximo: 1, ventanaMs: 60_000 });

    expect(cupo.intentar("piso-1", 0)).toBe(true);
    expect(cupo.intentar("piso-2", 0)).toBe(true);
    expect(cupo.intentar("piso-1", 0)).toBe(false);
  });

  it("pasada la ventana vuelve a haber cupo (y no deja el registro creciendo)", () => {
    const cupo = crearCupo({ maximo: 1, ventanaMs: 1_000 });

    expect(cupo.intentar("piso-1", 0)).toBe(true);
    expect(cupo.intentar("piso-1", 500)).toBe(false);
    expect(cupo.intentar("piso-1", 1_001)).toBe(true);
    expect(cupo.tamano()).toBe(1);
  });

  it("los topes del contrato: 20 envíos por hora y 20 mensajes por minuto", () => {
    expect(LIMITE_ENVIOS_KIOSCO).toEqual({ maximo: 20, ventanaMs: 60 * 60 * 1000 });
    expect(LIMITE_VICO_KIOSCO).toEqual({ maximo: 20, ventanaMs: 60 * 1000 });
  });
});
