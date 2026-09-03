import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correrVendedor,
  ETIQUETA_HERRAMIENTA,
  HERRAMIENTAS,
  herramientasPara,
  promptSistema,
  type CanalVendedor,
} from "./vendedor";
import { NOMBRES_HERRAMIENTAS_PEDIDO, type ActorVendedor } from "./vendedor-pedidos";
import { correrTurnoAgente } from "./agente-modelo";
import { consultaBdav } from "./db";
import { consultaUsadas } from "./db-usadas";
import { precioAldo } from "./aldo";

// Solo para la prueba del loop (correrVendedor): el modelo y las bases se
// sustituyen; el resto del archivo prueba funciones puras y no los usa.
vi.mock("./agente-modelo", () => ({ correrTurnoAgente: vi.fn() }));
vi.mock("./db", () => ({ consultaBdav: vi.fn() }));
vi.mock("./db-usadas", () => ({ consultaUsadas: vi.fn() }));
vi.mock("./aldo", () => ({ precioAldo: vi.fn() }));

const HOY = "2026-09-02";

// SHA-256 del prompt del actor SIN permiso de pedidos, por canal, con hoy =
// 2026-09-02. Para el anónimo (todo WhatsApp que no está en el padrón, y el
// chat de la página) el prompt tiene que seguir siendo ESE, byte a byte. Si
// cambias el prompt a propósito, regenera los hashes; si el test truena sin
// haberlo tocado, cambió el comportamiento de todos los clientes anónimos sin
// querer. Última regeneración: 3 sep 2026, al agregar la regla honesta "por
// este chat no puedes levantar pedidos ni guardar datos" (antes el modelo
// "tomaba datos" e inventaba un pedido registrado en la página pública).
const HASH_PROMPT_ORIGINAL: Record<CanalVendedor, string> = {
  whatsapp: "b8d11532b362445d1d0b2aae5b3cbf4acac7617097925b1d72d2944e1134afb3",
  web: "b1f4fc34eaa0a910be096882feaa4ecd88d0c17b0a231e6a482092f9549faf9c",
};

const CANALES: CanalVendedor[] = ["whatsapp", "web"];

const ANONIMO: ActorVendedor = { tipo: "anonimo" };
const CLIENTE: ActorVendedor = {
  tipo: "cliente",
  idCliente: 4,
  nombre: "Taller López",
  telefono: "8112345678",
  descuento: 38,
  permitirPedido: true,
};
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

function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

const REGLA_APARTADO_ORIGINAL = 'NUNCA ofrezcas apartar, reservar ni separar la pieza ("¿te la aparto?"';

describe("promptSistema sin permiso de pedidos", () => {
  it.each(CANALES)("canal %s: sin actor es byte a byte el prompt original", (canal) => {
    expect(sha256(promptSistema(HOY, canal))).toBe(HASH_PROMPT_ORIGINAL[canal]);
  });

  it.each(CANALES)("canal %s: sin actor y con actor anónimo es el mismo texto, sin sección PEDIDOS", (canal) => {
    const sinActor = promptSistema(HOY, canal);

    expect(promptSistema(HOY, canal, ANONIMO)).toBe(sinActor);
    expect(sinActor).not.toContain("PEDIDOS");
    expect(sinActor).toContain(REGLA_APARTADO_ORIGINAL);
  });

  it("un cliente del padrón sin permiso recibe exactamente el prompt anónimo", () => {
    const sinPermiso: ActorVendedor = { ...CLIENTE, permitirPedido: false };
    expect(promptSistema(HOY, "whatsapp", sinPermiso)).toBe(promptSistema(HOY, "whatsapp"));
  });
});

describe("promptSistema con permiso de pedidos", () => {
  it("cliente autorizado: sección PEDIDOS con su nombre y descuento, sin la regla vieja de apartado", () => {
    const prompt = promptSistema(HOY, "whatsapp", CLIENTE);

    expect(prompt).toContain("PEDIDOS (puedes levantar pedidos):");
    expect(prompt).toContain("El cliente es Taller López, del padrón, con 38% de descuento");
    expect(prompt).toContain("Solo puede pedir para sí mismo");
    expect(prompt).not.toContain(REGLA_APARTADO_ORIGINAL);
    expect(prompt).toContain("NUNCA lo llames apartado");
    // El cliente no tiene seleccionar_cliente, así que el prompt no la menciona.
    expect(prompt).not.toContain("seleccionar_cliente");
    // Sigue siendo el vendedor que atiende por WhatsApp y conserva el marcador de fotos.
    expect(prompt).toContain("atendiendo a un cliente por WhatsApp");
    expect(prompt).toContain("[[FOTOS:");
  });

  it("vendedor con cliente del padrón: se dirige a él, sabe a quién atiende y con qué descuento", () => {
    const prompt = promptSistema(HOY, "whatsapp", VENDEDOR);

    expect(prompt).toContain("apoyas a Juan Pérez (vendedor del mostrador)");
    expect(prompt).toContain("Está atendiendo a Taller López con 38% de descuento del padrón");
    expect(prompt).toContain("seleccionar_cliente");
    expect(prompt).toContain("la selección la fija el vendedor EN PANTALLA");
    expect(prompt).not.toContain("atendiendo a un cliente por WhatsApp");
  });

  it("vendedor con público general lo dice y no inventa descuento", () => {
    const publico: ActorVendedor = {
      ...VENDEDOR,
      idCliente: null,
      clienteNombre: null,
      clienteTelefono: null,
      descuento: null,
    };
    const prompt = promptSistema(HOY, "whatsapp", publico);

    expect(prompt).toContain("Está atendiendo a PÚBLICO GENERAL (sin descuento de padrón)");
    expect(prompt).not.toContain("null%");
  });

  it("la fecha y el canal siguen mandando en el resto del prompt", () => {
    const prompt = promptSistema("2030-01-15", "web", VENDEDOR);

    expect(prompt).toContain("Hoy es 2030-01-15.");
    expect(prompt).toContain("![](/api/articulos/foto?codigo=CODIGO)");
  });
});

describe("herramientasPara", () => {
  const nombres = (actor?: ActorVendedor) => herramientasPara(actor).map((h) => h.name);
  const conCache = (actor?: ActorVendedor) =>
    herramientasPara(actor)
      .filter((h) => "cache_control" in h && h.cache_control)
      .map((h) => h.name);

  it("el literal HERRAMIENTAS ya no trae cache_control fijo", () => {
    expect(HERRAMIENTAS.some((h) => "cache_control" in h && h.cache_control)).toBe(false);
  });

  it("anónimo (o sin actor): solo las cuatro del catálogo, cache_control en la última", () => {
    expect(nombres()).toEqual(["buscar_productos", "listar_marcas", "listar_tipos_parte", "buscar_piezas_usadas"]);
    expect(nombres(ANONIMO)).toEqual(nombres());
    expect(conCache()).toEqual(["buscar_piezas_usadas"]);
  });

  it("vendedor: catálogo + las siete de pedido, cache_control solo en la última", () => {
    expect(nombres(VENDEDOR)).toEqual([
      "buscar_productos",
      "listar_marcas",
      "listar_tipos_parte",
      "buscar_piezas_usadas",
      ...NOMBRES_HERRAMIENTAS_PEDIDO,
    ]);
    expect(conCache(VENDEDOR)).toEqual(["cancelar_pedido"]);
  });

  it("cliente autorizado: sin seleccionar_cliente; sin permiso: como anónimo", () => {
    expect(nombres(CLIENTE)).not.toContain("seleccionar_cliente");
    expect(nombres(CLIENTE)).toHaveLength(10);
    expect(nombres({ ...CLIENTE, permitirPedido: false })).toEqual(nombres());
  });

  it("no muta el literal al poner el cache_control", () => {
    herramientasPara(VENDEDOR);
    herramientasPara();
    expect(HERRAMIENTAS.some((h) => "cache_control" in h && h.cache_control)).toBe(false);
  });
});

describe("ETIQUETA_HERRAMIENTA", () => {
  it("tiene etiqueta de progreso para cada herramienta de pedido", () => {
    for (const nombre of NOMBRES_HERRAMIENTAS_PEDIDO) {
      expect(ETIQUETA_HERRAMIENTA[nombre]).toBeTruthy();
    }
  });
});

describe("correrVendedor → alResultados", () => {
  afterEach(() => vi.resetAllMocks());

  it("entrega el arreglo resultados de buscar_productos tal cual, con el precio que vio el modelo", async () => {
    // Arrange: una ronda con herramienta y otra con el texto final.
    const fila = {
      codigo: "DDDAI15",
      descripcion: "FASCIA DEL VERSA 15-19",
      marca: "NISSAN",
      tipoParte: "DEFENSAS DELANTERAS",
      aini: 2015,
      afin: 2019,
      precioSinIva: 1000,
      precioConIva: 1160,
      existencia: 2,
      localizacion: null,
    };
    vi.mocked(consultaBdav).mockResolvedValue([fila]);
    vi.mocked(consultaUsadas).mockResolvedValue([]);
    vi.mocked(precioAldo).mockResolvedValue({ encontrado: false } as never);
    vi.mocked(correrTurnoAgente)
      .mockResolvedValueOnce({
        contenido: [],
        usos: [{ id: "t1", name: "buscar_productos", input: { descripcion: "facia versa" } }],
      })
      .mockImplementationOnce(async (turno) => {
        turno.alTexto?.("Tengo la *Facia Versa 15-19* (DDDAI15) en *$1,160.00* 📦");
        return { contenido: [], usos: [] };
      });
    const alResultados = vi.fn();
    const alCodigos = vi.fn();

    // Act
    const texto = await correrVendedor({
      pregunta: "busca facia versa",
      historial: [],
      modelo: "claude-test",
      alResultados,
      alCodigos,
    });

    // Assert: mismo arreglo que ven alCodigos y el modelo, sin consultas extra.
    expect(texto).toContain("DDDAI15");
    expect(alResultados).toHaveBeenCalledTimes(1);
    expect(alResultados).toHaveBeenCalledWith("buscar_productos", [
      expect.objectContaining({ codigo: "DDDAI15", precioConIva: 1160, entregaInmediata: 2, sobrePedido: 0 }),
    ]);
    expect(alCodigos).toHaveBeenCalledWith(["DDDAI15"]);
    expect(consultaBdav).toHaveBeenCalledTimes(1);
  });

  it("no se invoca cuando la búsqueda no devolvió arreglo (error de catálogo)", async () => {
    vi.mocked(consultaBdav).mockRejectedValue(new Error("caída"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(correrTurnoAgente)
      .mockResolvedValueOnce({
        contenido: [],
        usos: [{ id: "t1", name: "buscar_productos", input: { descripcion: "x" } }],
      })
      .mockResolvedValueOnce({ contenido: [], usos: [] });
    const alResultados = vi.fn();

    await correrVendedor({ pregunta: "x", historial: [], modelo: "claude-test", alResultados });

    expect(alResultados).not.toHaveBeenCalled();
  });
});
