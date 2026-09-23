import { describe, expect, it } from "vitest";
import { validarAceptacion, vistaCotizacion } from "./cotizacion-aceptacion";
import type { PedidoDetalle } from "./pedidos";

const PEDIDO = {
  id: 230,
  folio: null,
  estatus: "borrador",
  canal: "mostrador",
  idCliente: 7,
  idClienteBdav: 55,
  cliente: "Taller López",
  telefono: "8112345678",
  descuentoPct: 38,
  sucursal: "fierro",
  capturadoPor: "polendo",
  subtotal: 1474,
  iva: 235.84,
  total: 1709.84,
  observaciones: "Lo recoge el chofer",
  domicilio: { calle: "Calle 1", colonia: "Centro", cp: "64000", municipio: "Monterrey", estado: "Nuevo León", telefono: null },
  aceptacion: null,
  creadoEn: "2026-09-22 10:00:00",
  numCotizaPos: 166789,
  eventos: [{ id: 1, evento: "creado" }],
  partidas: [
    { partida: 1, codigo: "DDNVE15", idPiezaUsada: null, descripcion: "FASCIA DEL VERSA 15-19", cantidad: 2, precioUnitario: 854.92, importe: 1709.84, existenciaAlPedir: 6, nota: "apartada" },
  ],
} as unknown as PedidoDetalle;

describe("vistaCotizacion", () => {
  it("deja pasar solo lo que el cliente necesita ver, y nada del padrón, el POS ni la bitácora", () => {
    const vista = vistaCotizacion(PEDIDO);
    expect(vista).toEqual({
      id: 230,
      folio: null,
      estado: "cotizacion",
      cliente: "Taller López",
      sucursal: "fierro",
      sucursalNombre: "Ruta",
      domicilio: "Calle 1, Centro, 64000 Monterrey, Nuevo León",
      observaciones: "Lo recoge el chofer",
      partidas: [{ partida: 1, codigo: "DDNVE15", descripcion: "FASCIA DEL VERSA 15-19", cantidad: 2, precioUnitario: 854.92, importe: 1709.84 }],
      subtotal: 1474,
      iva: 235.84,
      total: 1709.84,
      creadoEn: "2026-09-22 10:00:00",
      aceptacion: null,
    });
    const crudo = JSON.stringify(vista);
    for (const secreto of ["8112345678", "166789", "polendo", "eventos", "existenciaAlPedir", "apartada", "descuento"]) {
      expect(crudo).not.toContain(secreto);
    }
  });

  it("ya aceptada es pedido, con folio; cancelada se dice", () => {
    expect(vistaCotizacion({ ...PEDIDO, estatus: "enviado", folio: "P-000230" }).estado).toBe("pedido");
    expect(vistaCotizacion({ ...PEDIDO, estatus: "cancelado" }).estado).toBe("cancelada");
  });
});

describe("validarAceptacion", () => {
  const firma = `data:image/png;base64,${"iVBORw0KGgo".repeat(3)}`;

  it("acepta nombre y firma PNG, y limpia el nombre", () => {
    expect(validarAceptacion({ nombre: "  Juan   Pérez ", firma })).toEqual({ ok: true, datos: { nombre: "Juan Pérez", firma } });
  });

  it("exige nombre, firma en PNG y un tamaño razonable", () => {
    expect(validarAceptacion({ nombre: "Jo", firma }).ok).toBe(false);
    expect(validarAceptacion({ nombre: "Juan Pérez", firma: "" }).ok).toBe(false);
    expect(validarAceptacion({ nombre: "Juan Pérez", firma: "data:image/jpeg;base64,AAAA" }).ok).toBe(false);
    expect(validarAceptacion({ nombre: "Juan Pérez", firma: `data:image/png;base64,${"A".repeat(200_001)}` }).ok).toBe(false);
    expect(validarAceptacion("firma").ok).toBe(false);
  });
});
