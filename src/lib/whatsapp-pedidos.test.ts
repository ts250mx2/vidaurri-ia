import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartidaPedido, PedidoDetalle, PedidoResumen } from "./pedidos";
import type { ActorVendedor } from "./vendedor-pedidos";
import {
  enlacePdfSiSeEnvio,
  notaContextoPedido,
  preguntaConNota,
  textoConEnlacePdf,
} from "./whatsapp-pedidos";

const CLIENTE: ActorVendedor = {
  tipo: "cliente",
  idCliente: 5759,
  nombre: "JUAN RUBEN HERNANDEZ GONZALEZ",
  telefono: "8186921848",
  descuento: 38,
  permitirPedido: true,
};

const RESUMEN: PedidoResumen = {
  id: 21,
  folio: "P-000021",
  estatus: "enviado",
  canal: "whatsapp",
  idCliente: 5759,
  idClienteBdav: null,
  cliente: CLIENTE.tipo === "cliente" ? CLIENTE.nombre : "",
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
  creadoEn: "2026-09-03 00:19:31",
  enviadoEn: "2026-09-03 00:20:10",
  confirmadoEn: null,
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-03 00:20:10",
};

function partida(id: number, codigo: string, cantidad: number): PartidaPedido {
  return {
    id,
    partida: id,
    origen: "nueva",
    codigo,
    idPiezaUsada: null,
    descripcion: `FARO ${codigo}`,
    cantidad,
    precioUnitario: 2301.44,
    importe: 2301.44 * cantidad,
    existenciaAlPedir: 3,
    estatusPartida: "pendiente",
    diasEntrega: null,
    nota: null,
  };
}

const BORRADOR: PedidoDetalle = {
  ...RESUMEN,
  folio: null,
  estatus: "borrador",
  enviadoEn: null,
  observaciones: null,
  folioVentaPos: null,
  motivoCancelacion: null,
  eventos: [],
  partidas: [partida(1, "20-C031-B5-6B", 1), partida(2, "20-C032-B5-6B", 2)],
};

describe("notaContextoPedido", () => {
  it("al número que no está en el padrón le explica que no puede pedir", () => {
    const nota = notaContextoPedido({ tipo: "anonimo" }, null);
    expect(nota).toContain("NO está en el padrón");
    expect(nota).toContain("permiso de pedidos");
  });

  it("al cliente registrado sin permiso le dice que lo activen en el mostrador", () => {
    const nota = notaContextoPedido({ ...CLIENTE, permitirPedido: false }, null);
    expect(nota).toContain("JUAN RUBEN HERNANDEZ GONZALEZ");
    expect(nota).toContain("NO tiene habilitado levantar pedidos");
    expect(nota).toContain("mostrador");
  });

  it("con permiso y sin pedido en captura no hay nada que avisar", () => {
    expect(notaContextoPedido(CLIENTE, null)).toBeNull();
    expect(notaContextoPedido(CLIENTE, { ...BORRADOR, partidas: [] })).toBeNull();
  });

  it("con pedido en captura le recuerda confirmar en vez de volver a agregar, sin citar códigos", () => {
    const nota = notaContextoPedido(CLIENTE, BORRADOR) ?? "";
    expect(nota).toContain("3 pieza(s) en 2 renglón(es)");
    expect(nota).toContain("confirmar_pedido");
    expect(nota).toContain("NO llames agregar_al_pedido");
    expect(nota).not.toContain("20-C031-B5-6B");
    expect(nota).not.toContain("2,301");
  });

  it("al vendedor del mostrador no le pone notas", () => {
    const vendedor: ActorVendedor = {
      tipo: "vendedor",
      usuario: "tony",
      nombre: "Tony",
      perfil: "Ventas",
      idCliente: null,
      clienteNombre: null,
      clienteTelefono: null,
      descuento: null,
    };
    expect(notaContextoPedido(vendedor, BORRADOR)).toBeNull();
  });
});

describe("preguntaConNota", () => {
  it("antepone la nota al mensaje del cliente, o deja el mensaje tal cual", () => {
    expect(preguntaConNota(null, "Si")).toBe("Si");
    expect(preguntaConNota("Nota interna", "Si")).toBe("Nota interna\n\nMensaje del cliente: Si");
  });
});

describe("enlacePdfSiSeEnvio", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "secreto-de-prueba");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("solo hay liga cuando el último pedido se envió en este turno", () => {
    const base = "https://vidaurri.hlsistemas.com";
    const enlace = enlacePdfSiSeEnvio(RESUMEN, "2026-09-03 00:20:10", base);
    expect(enlace?.folio).toBe("P-000021");
    expect(enlace?.url).toMatch(/^https:\/\/vidaurri\.hlsistemas\.com\/api\/pedidos\/21\/pdf\?f=[0-9a-f]{32}$/);

    expect(enlacePdfSiSeEnvio(RESUMEN, "2026-09-03 00:20:11", base)).toBeNull();
    expect(enlacePdfSiSeEnvio({ ...RESUMEN, folio: null, enviadoEn: null }, "2026-09-03 00:00:00", base)).toBeNull();
    expect(enlacePdfSiSeEnvio(undefined, "2026-09-03 00:00:00", base)).toBeNull();
    expect(enlacePdfSiSeEnvio(RESUMEN, "2026-09-03 00:20:10", "")).toBeNull();
  });

  it("la liga se pega al final del mensaje del vendedor", () => {
    expect(textoConEnlacePdf("Listo, tu pedido P-000021 quedó enviado 👍\n", { folio: "P-000021", url: "https://x/p" })).toBe(
      "Listo, tu pedido P-000021 quedó enviado 👍\n\n📄 Tu pedido P-000021 en PDF: https://x/p"
    );
  });
});
