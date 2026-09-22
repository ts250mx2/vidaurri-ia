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

// SHA-256 del prompt del actor KIOSCO, por canal, con hoy = 2026-09-02. El
// kiosco es una pantalla sola en el piso de la tienda: si este prompt cambia
// sin querer, nadie se entera hasta que un cliente se va creyendo que su
// pedido "quedó registrado" (que es justo lo que este prompt prohíbe). Si lo
// cambias a propósito, regenera el hash y di por qué.
// Última regeneración: 15 sep 2026, al crear el kiosco de autoservicio.
const HASH_PROMPT_KIOSCO: Record<CanalVendedor, string> = {
  whatsapp: "21d5daad995f7e860ffab210275b8581e21d8d84a069dbf901007233734d7cb1",
  web: "c3a7194ec12e6a8ecf95c046b92f4fe99916f71182867b36c6cb0938783f44ab",
};

// SHA-256 del prompt del actor KIOSCO con un CLIENTE DEL PADRÓN (Taller
// López, 38%), por canal, con hoy = 2026-09-02. Es el de arriba con un solo
// renglón distinto (el del precio): si este cambia y el de arriba no, alguien
// tocó lo que Vico le dice al cliente que entró con su celular. Si lo cambias
// a propósito, regenera el hash y di por qué.
// Última regeneración: 15 sep 2026, al dejar entrar al cliente con su celular.
const HASH_PROMPT_KIOSCO_CLIENTE: Record<CanalVendedor, string> = {
  whatsapp: "cfbde32393c2ea08e4f3b8fe28e741502efe6118a0a375fa9deecc17fe4c05d1",
  web: "6a8ddd865a28ecf711898bfe4569e9a30e31b48fd3c765ffd10bef3086238ae5",
};

// SHA-256 del prompt del CLIENTE DEL PADRÓN en el ÁREA DE CLIENTES de la web
// (actor cliente con canal "web"; Taller López, 38%), por canal, con hoy =
// 2026-09-02. Misma regla que el kiosco: Vico solo arma la lista y el pedido
// se registra con el botón de la pantalla; si este prompt cambia sin querer,
// el cliente puede irse creyendo que su pedido ya se mandó. El cliente por
// WhatsApp (sin canal) NO cambia. Si lo cambias a propósito, regenera el hash
// y di por qué. Última regeneración: 22 sep 2026, al renombrar las sucursales
// en los pedidos ("Mostrador o Ruta" en vez de "Matriz o Sucursal Fierro").
const HASH_PROMPT_CLIENTE_WEB: Record<CanalVendedor, string> = {
  whatsapp: "9746c2bde576e2f39acf247c98075d7c1a3d72216ad4178086255a6c0df184d5",
  web: "aa9e1d5a22047993ede5d649276aeb75cc212213e183806176f4c93d9c5287dd",
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
const CLIENTE_WEB: ActorVendedor = { ...CLIENTE, canal: "web" };
const KIOSCO: ActorVendedor = { tipo: "kiosco", kiosco: "piso-1", sucursal: "matriz", cliente: null };
const KIOSCO_CLIENTE: ActorVendedor = {
  ...KIOSCO,
  cliente: { idCliente: 4, nombre: "Taller López", descuento: 38 },
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

describe("promptSistema del kiosco de autoservicio", () => {
  it.each(CANALES)("canal %s: es byte a byte el prompt acordado", (canal) => {
    expect(sha256(promptSistema(HOY, canal, KIOSCO))).toBe(HASH_PROMPT_KIOSCO[canal]);
  });

  it("prohíbe decir que el pedido quedó registrado y manda al botón de la pantalla", () => {
    const prompt = promptSistema(HOY, "whatsapp", KIOSCO);

    expect(prompt).toContain("PEDIDOS (kiosco de autoservicio):");
    expect(prompt).toContain("PROHIBIDO decir que el pedido quedó registrado");
    expect(prompt).toContain("SOLO se registra cuando el cliente toca el botón de enviar");
  });

  it("no pide datos personales, no promete plazos ni apartados y no cita descuentos", () => {
    const prompt = promptSistema(HOY, "whatsapp", KIOSCO);

    expect(prompt).toContain("NO le pidas su nombre, su celular ni ningún dato personal");
    expect(prompt).toContain("No prometas plazos, días de entrega ni apartados");
    expect(prompt).toContain("NUNCA apliques ni menciones descuentos");
    expect(prompt).toContain("IVA incluido");
    // Nada de tomar datos para conseguir la pieza: eso es del chat con vendedor.
    expect(prompt).not.toContain("ofrece tomar sus datos");
    // Y nada de las tools que no tiene.
    expect(prompt).not.toContain("confirmar_pedido");
    expect(prompt).not.toContain("seleccionar_cliente");
    expect(prompt).not.toContain("cambiar_sucursal");
  });

  it("le habla al cliente de la pantalla, no a un vendedor ni a un chat de WhatsApp", () => {
    const prompt = promptSistema(HOY, "whatsapp", KIOSCO);

    expect(prompt).toContain("pantalla de autoservicio");
    expect(prompt).toContain("PARADO EN EL MOSTRADOR");
    expect(prompt).not.toContain("atendiendo a un cliente por WhatsApp");
    expect(prompt).not.toContain("vendedor del mostrador");
  });

  it("el prompt del anónimo sigue intacto pese al actor nuevo", () => {
    for (const canal of CANALES) {
      expect(sha256(promptSistema(HOY, canal))).toBe(HASH_PROMPT_ORIGINAL[canal]);
    }
  });
});

describe("promptSistema del cliente en el área de clientes de la web", () => {
  it.each(CANALES)("canal %s: es byte a byte el prompt acordado", (canal) => {
    expect(sha256(promptSistema(HOY, canal, CLIENTE_WEB))).toBe(HASH_PROMPT_CLIENTE_WEB[canal]);
  });

  it("misma regla que el kiosco: prohibido decir que quedó enviado, el botón y la sucursal son de la pantalla", () => {
    const prompt = promptSistema(HOY, "whatsapp", CLIENTE_WEB);

    expect(prompt).toContain("PEDIDOS (área de clientes de la web):");
    expect(prompt).toContain("PROHIBIDO decir que el pedido quedó registrado");
    expect(prompt).toContain('SOLO se registra cuando el cliente toca el botón "Enviar pedido"');
    expect(prompt).toContain("la elige él ahí, no en este chat");
    expect(prompt).toContain("Taller López");
    expect(prompt).toContain("38% de descuento");
    expect(prompt).toContain("IVA incluido");
    expect(prompt).not.toContain("confirmar_pedido");
    expect(prompt).not.toContain("cambiar_sucursal");
    expect(prompt).not.toContain("cancelar_pedido");
    expect(prompt).not.toContain("ofrece tomar sus datos");
    expect(prompt).not.toContain("atendiendo a un cliente por WhatsApp");
  });

  it("solo tiene las tres tools de armar el pedido", () => {
    expect(herramientasPara(CLIENTE_WEB).map((h) => h.name)).toEqual([
      ...herramientasPara().map((h) => h.name),
      "agregar_al_pedido",
      "ver_pedido",
      "quitar_del_pedido",
    ]);
  });

  it("el cliente por WhatsApp (sin canal) sigue con su prompt y sus seis tools", () => {
    const prompt = promptSistema(HOY, "whatsapp", CLIENTE);

    expect(prompt).toContain("PEDIDOS (puedes levantar pedidos):");
    expect(prompt).toContain("confirmar_pedido");
    expect(prompt).not.toContain("área de clientes");
    expect(herramientasPara(CLIENTE).map((h) => h.name)).toEqual([
      ...herramientasPara().map((h) => h.name),
      ...NOMBRES_HERRAMIENTAS_PEDIDO.filter((n) => n !== "seleccionar_cliente"),
    ]);
  });

  it("el anónimo y el kiosco siguen intactos", () => {
    for (const canal of CANALES) {
      expect(sha256(promptSistema(HOY, canal))).toBe(HASH_PROMPT_ORIGINAL[canal]);
      expect(sha256(promptSistema(HOY, canal, KIOSCO))).toBe(HASH_PROMPT_KIOSCO[canal]);
      expect(sha256(promptSistema(HOY, canal, KIOSCO_CLIENTE))).toBe(HASH_PROMPT_KIOSCO_CLIENTE[canal]);
    }
  });
});

describe("promptSistema del kiosco con el cliente que entró con su celular", () => {
  it.each(CANALES)("canal %s: es byte a byte el prompt acordado", (canal) => {
    expect(sha256(promptSistema(HOY, canal, KIOSCO_CLIENTE))).toBe(HASH_PROMPT_KIOSCO_CLIENTE[canal]);
  });

  it("sabe a quién atiende y con qué descuento, con la misma frase que ve el vendedor", () => {
    const prompt = promptSistema(HOY, "whatsapp", KIOSCO_CLIENTE);

    expect(prompt).toContain("Está atendiendo a Taller López con 38% de descuento del padrón");
    expect(prompt).toContain("YA lo llevan");
    expect(prompt).toContain("IVA incluido");
    expect(prompt).toContain("Salúdalo por su nombre");
    // Ya no es precio de mostrador ni "aquí no existen los descuentos".
    expect(prompt).not.toContain("NUNCA apliques ni menciones descuentos");
    expect(prompt).not.toContain("son los de MOSTRADOR");
  });

  it("todo lo demás del kiosco sigue igual: sin datos personales, sin registrar, sin plazos, mismas tools", () => {
    const conCliente = promptSistema(HOY, "whatsapp", KIOSCO_CLIENTE);
    const sinCliente = promptSistema(HOY, "whatsapp", KIOSCO);

    for (const regla of [
      "PEDIDOS (kiosco de autoservicio):",
      "PROHIBIDO decir que el pedido quedó registrado",
      "NO le pidas su nombre, su celular ni ningún dato personal",
      "No prometas plazos, días de entrega ni apartados",
      "PARADO EN EL MOSTRADOR",
    ]) {
      expect(conCliente).toContain(regla);
    }
    expect(conCliente).not.toContain("confirmar_pedido");
    expect(conCliente).not.toContain("seleccionar_cliente");
    // Solo difieren en un renglón: el del precio.
    const distintos = conCliente.split("\n").filter((linea) => !sinCliente.includes(linea));
    expect(distintos).toHaveLength(1);
    expect(distintos[0]).toContain("Taller López");
  });

  it("el kiosco sin cliente y el anónimo siguen intactos pese al cliente nuevo", () => {
    for (const canal of CANALES) {
      expect(sha256(promptSistema(HOY, canal, KIOSCO))).toBe(HASH_PROMPT_KIOSCO[canal]);
      expect(sha256(promptSistema(HOY, canal))).toBe(HASH_PROMPT_ORIGINAL[canal]);
    }
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

  it("kiosco: catálogo + SOLO las tres de armar el pedido", () => {
    expect(nombres(KIOSCO)).toEqual([
      "buscar_productos",
      "listar_marcas",
      "listar_tipos_parte",
      "buscar_piezas_usadas",
      "agregar_al_pedido",
      "ver_pedido",
      "quitar_del_pedido",
    ]);
    // Mandar el pedido es un botón de la pantalla, no del chat.
    for (const prohibida of ["confirmar_pedido", "cancelar_pedido", "cambiar_sucursal", "seleccionar_cliente"]) {
      expect(nombres(KIOSCO)).not.toContain(prohibida);
    }
    expect(conCache(KIOSCO)).toEqual(["quitar_del_pedido"]);
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
      credencial: { proveedor: "claude", modelo: "claude-test", baseURL: "http://hl/api/ws/proxy/prueba", headers: {} },
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

    await correrVendedor({ pregunta: "x", historial: [], credencial: { proveedor: "claude", modelo: "claude-test", baseURL: "http://hl/api/ws/proxy/prueba", headers: {} }, alResultados });

    expect(alResultados).not.toHaveBeenCalled();
  });
});
