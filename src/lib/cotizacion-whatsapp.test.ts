import { describe, expect, it } from "vitest";
import { textoCotizacionWhatsapp, tituloCotizacion } from "./cotizacion-whatsapp";
import type { PartidaPedido, PedidoDetalle } from "./pedidos";

function partida(n: number, extra: Partial<PartidaPedido> = {}): PartidaPedido {
  return {
    id: n,
    partida: n,
    origen: "nueva",
    codigo: `COD${n}`,
    idPiezaUsada: null,
    descripcion: `PIEZA ${n}`,
    cantidad: 1,
    precioUnitario: 116,
    importe: 116,
    existenciaAlPedir: 1,
    estatusPartida: "pendiente",
    diasEntrega: null,
    cantidadAldo: null,
    nota: null,
    foto: null,
    ...extra,
  };
}

const BORRADOR = {
  id: 228,
  folio: null,
  estatus: "borrador",
  cliente: "Taller López",
  telefono: "8112345678",
  total: 232,
  partidas: [partida(1), partida(2, { cantidad: 2, descripcion: "FASCIA DEL VERSA 15-19", precioUnitario: 854.92 })],
} as unknown as PedidoDetalle;

describe("tituloCotizacion", () => {
  it("un borrador va por su número; un pedido con folio, por el folio", () => {
    expect(tituloCotizacion(BORRADOR)).toBe("Cotización #228");
    expect(tituloCotizacion({ ...BORRADOR, folio: "P-000228" })).toBe("Cotización del pedido P-000228");
  });
});

describe("textoCotizacionWhatsapp", () => {
  it("saluda al cliente, lista las piezas con precio, el total con IVA y la liga al PDF", () => {
    const texto = textoCotizacionWhatsapp(BORRADOR, "https://x.mx/api/pedidos/228/pdf?c=abc");
    expect(texto).toContain("Hola, *Taller López*.");
    expect(texto).toContain("*cotización #228*");
    expect(texto).toContain("• 2 × FASCIA DEL VERSA 15-19 — $854.92");
    expect(texto).toContain("*Total: $232.00* (IVA incluido)");
    expect(texto).toContain("📄 Cotización en PDF: https://x.mx/api/pedidos/228/pdf?c=abc");
    expect(texto).toContain("sujetos a existencia");
  });

  it("al público general no lo saluda por nombre, y con muchas piezas remite al PDF", () => {
    const largo = {
      ...BORRADOR,
      cliente: "Público general",
      partidas: Array.from({ length: 8 }, (_, i) => partida(i + 1)),
    } as unknown as PedidoDetalle;
    const texto = textoCotizacionWhatsapp(largo, "https://x.mx/p");
    expect(texto.startsWith("Hola. Te mandamos")).toBe(true);
    expect(texto).toContain("• …y 2 piezas más (ver PDF)");
    expect(texto).not.toContain("PIEZA 7");
  });
});
