import { describe, expect, it } from "vitest";
import type { PedidoDetalle } from "./pedidos";
import {
  NOMBRES_HERRAMIENTAS_PEDIDO,
  avisoExistencia,
  ejecutarHerramientaPedido,
  esHerramientaPedido,
  formatearRespuestaPedido,
  herramientasPedidoPara,
  partidaEnPedido,
  puedePedir,
  type ActorVendedor,
} from "./vendedor-pedidos";

const ANONIMO: ActorVendedor = { tipo: "anonimo" };
const CLIENTE: ActorVendedor = {
  tipo: "cliente",
  idCliente: 4,
  nombre: "Taller López",
  telefono: "8112345678",
  descuento: 38,
  permitirPedido: true,
};
const CLIENTE_SIN_PERMISO: ActorVendedor = { ...CLIENTE, permitirPedido: false };
const VENDEDOR: ActorVendedor = {
  tipo: "vendedor",
  usuario: "jperez",
  nombre: "Juan Pérez",
  perfil: "Ventas",
  idCliente: 4,
  clienteNombre: "Taller López",
  clienteTelefono: "8112345678",
  descuento: 38,
};

const PEDIDO: PedidoDetalle = {
  id: 131,
  folio: "P-000131",
  estatus: "enviado",
  canal: "mostrador",
  idCliente: 4,
  idClienteBdav: null,
  cliente: "Taller López",
  telefono: "8112345678",
  descuentoPct: 38,
  sucursal: "fierro",
  capturadoPor: "jperez",
  atendidoPor: null,
  subtotal: 3100,
  iva: 496,
  total: 3596,
  numPartidas: 2,
  numCotizaPos: null,
  cotizaPosEstado: "pendiente",
  cotizaPosError: null,
  numBkoPos: null,
  bkoPosEstado: "pendiente",
  bkoPosError: null,
  bkoPosCompromiso: null,
  creadoEn: "2026-09-02 10:00:00",
  enviadoEn: "2026-09-02 10:05:00",
  confirmadoEn: null,
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-02 10:05:00",
  observaciones: null,
  folioVentaPos: null,
  motivoCancelacion: null,
  partidas: [
    {
      id: 900,
      partida: 1,
      origen: "nueva",
      codigo: "DDDAI15",
      idPiezaUsada: null,
      descripcion: "FASCIA DEL VERSA 15-19",
      cantidad: 2,
      precioUnitario: 1798,
      importe: 3596,
      existenciaAlPedir: 3,
      estatusPartida: "pendiente",
      diasEntrega: null,
      nota: null,
    },
    {
      id: 901,
      partida: 2,
      origen: "usada",
      codigo: null,
      idPiezaUsada: 5512,
      descripcion: "FARO IZQ · NISSAN VERSA",
      cantidad: 1,
      precioUnitario: 0,
      importe: 0,
      existenciaAlPedir: 1,
      estatusPartida: "pendiente",
      diasEntrega: null,
      nota: null,
    },
  ],
  eventos: [],
};

describe("puedePedir", () => {
  it("el vendedor siempre puede", () => {
    expect(puedePedir(VENDEDOR)).toBe(true);
    expect(puedePedir({ ...VENDEDOR, idCliente: null, clienteNombre: null, clienteTelefono: null, descuento: null })).toBe(
      true
    );
  });

  it("el cliente solo si el padrón lo autoriza", () => {
    expect(puedePedir(CLIENTE)).toBe(true);
    expect(puedePedir(CLIENTE_SIN_PERMISO)).toBe(false);
  });

  it("el anónimo y la ausencia de actor nunca", () => {
    expect(puedePedir(ANONIMO)).toBe(false);
    expect(puedePedir(undefined)).toBe(false);
  });
});

describe("herramientasPedidoPara", () => {
  it("no da ninguna tool a quien no puede pedir", () => {
    expect(herramientasPedidoPara(undefined)).toEqual([]);
    expect(herramientasPedidoPara(ANONIMO)).toEqual([]);
    expect(herramientasPedidoPara(CLIENTE_SIN_PERMISO)).toEqual([]);
  });

  it("al vendedor le da las siete, con seleccionar_cliente; al cliente seis, sin ella", () => {
    const vendedor = herramientasPedidoPara(VENDEDOR).map((h) => h.name);
    const cliente = herramientasPedidoPara(CLIENTE).map((h) => h.name);

    expect(vendedor).toEqual([...NOMBRES_HERRAMIENTAS_PEDIDO]);
    expect(cliente).toEqual(NOMBRES_HERRAMIENTAS_PEDIDO.filter((n) => n !== "seleccionar_cliente"));
  });

  it("los esquemas son JSON Schema de objeto (válidos para Anthropic y OpenAI) y sin cache_control fijo", () => {
    for (const tool of herramientasPedidoPara(VENDEDOR)) {
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe("object");
      expect(typeof tool.input_schema.properties).toBe("object");
      expect("cache_control" in tool && tool.cache_control).toBeFalsy();
      const requeridas = (tool.input_schema as { required?: string[] }).required ?? [];
      for (const campo of requeridas) {
        expect(Object.keys(tool.input_schema.properties as object)).toContain(campo);
      }
    }
  });

  it("agregar_al_pedido exige cantidad y acepta código o pieza usada", () => {
    const tool = herramientasPedidoPara(CLIENTE).find((h) => h.name === "agregar_al_pedido");
    const esquema = tool?.input_schema as { properties: Record<string, unknown>; required?: string[] };

    expect(esquema.required).toEqual(["cantidad"]);
    expect(Object.keys(esquema.properties).sort()).toEqual(["cantidad", "codigo", "idPiezaUsada"]);
  });
});

describe("esHerramientaPedido", () => {
  it("reconoce solo los nombres de las tools de pedido", () => {
    for (const nombre of NOMBRES_HERRAMIENTAS_PEDIDO) expect(esHerramientaPedido(nombre)).toBe(true);
    expect(esHerramientaPedido("buscar_productos")).toBe(false);
    expect(esHerramientaPedido("")).toBe(false);
  });
});

describe("formatearRespuestaPedido", () => {
  it("sin pedido devuelve la forma vacía del contrato", () => {
    expect(formatearRespuestaPedido(null)).toEqual({ pedido: null, resultados: [], folios: [], importes: [] });
  });

  it("resume el pedido y repite folio e importes donde los apunta el anti-alucinación", () => {
    const respuesta = formatearRespuestaPedido(PEDIDO);

    expect(respuesta.folios).toEqual(["P-000131"]);
    expect(respuesta.importes).toEqual([3100, 496, 3596, 3596, 0]);
    expect(respuesta.resultados).toEqual([
      { codigo: "DDDAI15", descripcion: "FASCIA DEL VERSA 15-19", precioConIva: 1798, cantidad: 2, importe: 3596 },
      { codigo: null, descripcion: "FARO IZQ · NISSAN VERSA", precioConIva: 0, cantidad: 1, importe: 0 },
    ]);
    expect(respuesta.pedido).toMatchObject({
      id: 131,
      folio: "P-000131",
      estatus: "enviado",
      cliente: "Taller López",
      descuentoPct: 38,
      sucursal: "fierro",
      sucursalNombre: "Sucursal Fierro",
      total: 3596,
      numPartidas: 2,
    });
    expect(respuesta.pedido?.partidas[0]).toEqual({
      idPartida: 900,
      partida: 1,
      origen: "nueva",
      codigo: "DDDAI15",
      idPiezaUsada: null,
      descripcion: "FASCIA DEL VERSA 15-19",
      cantidad: 2,
      precioConIva: 1798,
      importe: 3596,
      existenciaAlPedir: 3,
    });
  });

  it("no expone eventos ni teléfono al modelo", () => {
    const pedido = formatearRespuestaPedido(PEDIDO).pedido as unknown as Record<string, unknown>;

    expect(pedido).not.toHaveProperty("eventos");
    expect(pedido).not.toHaveProperty("telefono");
  });

  it("un borrador (sin folio) no aporta folios", () => {
    const respuesta = formatearRespuestaPedido({ ...PEDIDO, folio: null, estatus: "borrador" });

    expect(respuesta.folios).toEqual([]);
    expect(respuesta.pedido?.folio).toBeNull();
  });
});

describe("partidaEnPedido", () => {
  it("encuentra la pieza nueva por código sin importar mayúsculas", () => {
    expect(partidaEnPedido(PEDIDO, { codigo: "dddai15", idPiezaUsada: null })?.id).toBe(900);
  });

  it("encuentra la pieza usada por id, no por código", () => {
    expect(partidaEnPedido(PEDIDO, { codigo: null, idPiezaUsada: 5512 })?.id).toBe(901);
    expect(partidaEnPedido(PEDIDO, { codigo: null, idPiezaUsada: 1 })).toBeUndefined();
  });

  it("no confunde un código con una usada sin código", () => {
    expect(partidaEnPedido(PEDIDO, { codigo: null, idPiezaUsada: null })).toBeUndefined();
  });
});

describe("avisoExistencia", () => {
  it("no avisa mientras el pedido cabe en la existencia", () => {
    expect(avisoExistencia(1, 1)).toBeNull();
    expect(avisoExistencia(3, 2)).toBeNull();
  });

  it("avisa con la cantidad acumulada del renglón, que es la que rebasa", () => {
    // Pieza con existencia 1 agregada dos veces de 1 en 1: el aviso habla de 2.
    expect(avisoExistencia(1, 2)).toBe(
      "Solo hay 1 en existencia de 2 pedidas: el mostrador confirmará cuántas surte y si el resto va sobre pedido."
    );
    expect(avisoExistencia(0, 1)).toContain("Solo hay 0 en existencia de 1 pedidas");
  });
});

describe("ejecutarHerramientaPedido con quien no puede pedir", () => {
  it("devuelve un error legible sin tocar la base", async () => {
    const uso = { id: "t1", name: "ver_pedido", input: {} };

    const anonimo = JSON.parse(await ejecutarHerramientaPedido(uso, ANONIMO));
    const sinPermiso = JSON.parse(await ejecutarHerramientaPedido(uso, CLIENTE_SIN_PERMISO));

    expect(anonimo).toEqual({ error: expect.stringContaining("no puede levantar pedidos") });
    expect(sinPermiso).toEqual({ error: expect.stringContaining("no puede levantar pedidos") });
  });
});
