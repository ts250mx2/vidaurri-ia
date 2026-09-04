import { describe, expect, it } from "vitest";
import type { PedidoDetalle } from "./pedidos";
import { datosDelPedido, fechaHoraPedido, generarPdfPedido, notasDelPedido } from "./pedido-pdf";

const PEDIDO: PedidoDetalle = {
  id: 21,
  folio: "P-000021",
  estatus: "enviado",
  canal: "whatsapp",
  idCliente: 5759,
  idClienteBdav: null,
  cliente: "JUAN RUBEN HERNANDEZ GONZALEZ",
  telefono: "8186921848",
  descuentoPct: 38,
  sucursal: "matriz",
  capturadoPor: "cliente",
  atendidoPor: null,
  subtotal: 3968,
  iva: 634.88,
  total: 4602.88,
  numPartidas: 2,
  numCotizaPos: null,
  cotizaPosEstado: "pendiente",
  cotizaPosError: null,
  numBkoPos: null,
  bkoPosEstado: "pendiente",
  bkoPosError: null,
  bkoPosCompromiso: null,
  creadoEn: "2026-09-03 00:19:31",
  enviadoEn: "2026-09-03 00:20:10",
  confirmadoEn: null,
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-03 00:20:10",
  observaciones: "Lado derecho con fondo negro",
  folioVentaPos: null,
  motivoCancelacion: null,
  eventos: [],
  partidas: [
    {
      id: 1,
      partida: 1,
      origen: "nueva",
      codigo: "20-C031-B5-6B",
      idPiezaUsada: null,
      descripcion: "FARO MAZDA 2 12-15/ USA 11-14 FONDO NEGRO S/MOTOR TYC CCC3 DER",
      cantidad: 1,
      precioUnitario: 2301.44,
      importe: 2301.44,
      existenciaAlPedir: 3,
      estatusPartida: "pendiente",
      diasEntrega: null,
      nota: null,
    },
    {
      id: 2,
      partida: 2,
      origen: "usada",
      codigo: null,
      idPiezaUsada: 1686,
      descripcion: "PUERTA DEL. DERECHA · DODGE JOURNEY",
      cantidad: 1,
      precioUnitario: 2301.44,
      importe: 2301.44,
      existenciaAlPedir: 1,
      estatusPartida: "pendiente",
      diasEntrega: null,
      nota: null,
    },
  ],
};

describe("datos y notas del pedido", () => {
  it("formatea la fecha de Monterrey y arma los datos de cabecera", () => {
    expect(fechaHoraPedido("2026-09-03 00:20:10")).toBe("03/09/2026 00:20");
    expect(fechaHoraPedido(null)).toBe("—");
    expect(datosDelPedido(PEDIDO)).toEqual([
      ["Cliente", "JUAN RUBEN HERNANDEZ GONZALEZ"],
      ["Teléfono", "8186921848"],
      ["Recoge en", "Matriz"],
      ["Levantado por", "WhatsApp"],
      ["Enviado el", "03/09/2026 00:20"],
    ]);
  });

  it("las notas llevan observaciones y la leyenda de sujeto a confirmación, o el motivo si se canceló", () => {
    expect(notasDelPedido(PEDIDO)).toEqual([
      "Observaciones: Lado derecho con fondo negro",
      expect.stringContaining("sujeto a confirmación de existencia"),
    ]);
    expect(
      notasDelPedido({ ...PEDIDO, estatus: "cancelado", observaciones: null, motivoCancelacion: "Era una prueba" })
    ).toEqual(["Pedido cancelado: Era una prueba."]);
  });
});

describe("generarPdfPedido", () => {
  it("genera un PDF de una página con la tabla de partidas y los totales", async () => {
    const pdf = await generarPdfPedido(PEDIDO);
    expect(pdf.byteLength).toBeGreaterThan(1500);
    expect(new TextDecoder("latin1").decode(pdf.slice(0, 8))).toMatch(/^%PDF-1\./);
  });

  it("un pedido largo se parte en páginas", async () => {
    const partidas = Array.from({ length: 60 }, (_, i) => ({
      ...PEDIDO.partidas[0],
      id: i + 1,
      partida: i + 1,
      codigo: `COD-${i + 1}`,
    }));
    const pdf = await generarPdfPedido({ ...PEDIDO, partidas, numPartidas: partidas.length });
    expect(pdf.byteLength).toBeGreaterThan(5000);
  });
});
