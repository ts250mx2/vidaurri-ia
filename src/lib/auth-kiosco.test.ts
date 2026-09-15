import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  CABECERA_KIOSCO,
  CABECERA_KIOSCO_CLIENTE,
  exigirKiosco,
  exigirKioscoConCliente,
  leerCabeceraCliente,
  leerCabeceraKiosco,
} from "./auth-kiosco";
import { firmarSesionMostrador } from "./auth-mostrador";
import { obtenerClienteDescuento } from "./db-clientes-descuento";
import type { ClienteDescuento } from "./clientes-descuento";

// El kiosco NO tiene sesión de persona: la credencial es del aparato. Estas
// pruebas cuidan las dos cosas que no pueden fallar nunca: que sin la API key
// de servidor a servidor no entre nadie, y que el JWT del mostrador no sirva
// aquí (si sirviera, cualquier vendedor con su token podría hablarle a las
// rutas del kiosco, y al revés la cookie del piso abriría el mostrador).
//
// Encima del aparato puede venir el CLIENTE que entró con su celular
// (X-Kiosco-Cliente): se revalida contra el padrón en cada llamada, porque la
// cookie la firma vidaurri-page y el motor no la ve; lo único que confía es
// el id, y solo si el padrón lo sigue teniendo.

vi.mock("./db-clientes-descuento", () => ({ obtenerClienteDescuento: vi.fn() }));

const API_KEY = "key-de-pruebas";

const CLIENTE: ClienteDescuento = {
  id: 4,
  telefono: "8112345678",
  telefonos: ["8112345678"],
  cliente: "Taller López",
  descuento: 38,
  rfc: null,
  telefono2: null,
  email: null,
  idClienteApv: null,
  idClienteBdav: null,
  permitirPedido: false,
  creadoPor: null,
  creadoEn: "2026-09-01 10:00:00",
  actualizadoPor: null,
  actualizadoEn: "2026-09-01 10:00:00",
};

function peticion(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/kiosco/borrador", { headers });
}

const CABECERAS_OK = { "x-api-key": API_KEY, [CABECERA_KIOSCO]: "piso-1|matriz" };

describe("leerCabeceraKiosco", () => {
  it("parte '<kiosco>|<sucursal>' y valida los dos lados", () => {
    expect(leerCabeceraKiosco("piso-1|matriz")).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
    expect(leerCabeceraKiosco(" mostrador-2 | fierro ")).toEqual({ kiosco: "mostrador-2", sucursal: "fierro" });
  });

  it("rechaza sucursales que no son del catálogo", () => {
    expect(leerCabeceraKiosco("piso-1|bodega")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|MATRIZ")).toBeNull();
  });

  it("rechaza identificadores fuera de [a-z0-9-]{1,30}", () => {
    for (const malo of ["", "Piso-1", "piso 1", "piso_1", "piso/../otro", "k".repeat(31), "piso;drop"]) {
      expect(leerCabeceraKiosco(`${malo}|matriz`)).toBeNull();
    }
    expect(leerCabeceraKiosco("k".repeat(30) + "|matriz")).not.toBeNull();
  });

  it("rechaza lo que no trae exactamente dos partes", () => {
    expect(leerCabeceraKiosco("piso-1")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|matriz|extra")).toBeNull();
    expect(leerCabeceraKiosco("")).toBeNull();
    expect(leerCabeceraKiosco(null)).toBeNull();
  });
});

describe("exigirKiosco", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = API_KEY;
    process.env.MOSTRADOR_JWT_SECRET = "secreto-de-pruebas-del-mostrador";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("deja pasar con API key y cabecera del aparato", async () => {
    const guardia = await exigirKiosco(peticion(CABECERAS_OK));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) expect(guardia.kiosco).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
  });

  it("sin API key no entra (401 con código api_key)", async () => {
    const guardia = await exigirKiosco(peticion({ [CABECERA_KIOSCO]: "piso-1|matriz" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ ok: false, codigo: "api_key" });
    }
  });

  it("con API key equivocada tampoco", async () => {
    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, "x-api-key": "otra" }));
    expect(guardia.ok).toBe(false);
  });

  it("sin la variable configurada la puerta queda cerrada", async () => {
    delete process.env.MOSTRADOR_API_KEY;
    const guardia = await exigirKiosco(peticion(CABECERAS_OK));
    expect(guardia.ok).toBe(false);
  });

  it("con API key pero sin cabecera del aparato: 401 de kiosco, no de sesión de vendedor", async () => {
    const guardia = await exigirKiosco(peticion({ "x-api-key": API_KEY }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ codigo: "kiosco" });
    }
  });

  it("NUNCA acepta el JWT del mostrador en lugar de la cabecera del aparato", async () => {
    const token = await firmarSesionMostrador({
      id: 7,
      usuario: "jperez",
      nombre: "Juan Pérez",
      perfil: "Administrador",
      nivel: 1,
      serie: null,
    });

    const guardia = await exigirKiosco(
      peticion({ "x-api-key": API_KEY, authorization: `Bearer ${token}` })
    );

    expect(guardia.ok).toBe(false);
  });

  it("un kiosco no puede decir que es de otra sucursal metiendo basura en la cabecera", async () => {
    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO]: "piso-1|matriz'--" }));
    expect(guardia.ok).toBe(false);
  });
});

describe("leerCabeceraCliente", () => {
  it("sin cabecera no hay cliente (público general, como siempre)", () => {
    expect(leerCabeceraCliente(null)).toEqual({ tipo: "sin_cliente" });
    expect(leerCabeceraCliente("")).toEqual({ tipo: "sin_cliente" });
    expect(leerCabeceraCliente("   ")).toEqual({ tipo: "sin_cliente" });
  });

  it("con un entero positivo trae el id del padrón", () => {
    expect(leerCabeceraCliente("4")).toEqual({ tipo: "cliente", idCliente: 4 });
    expect(leerCabeceraCliente(" 4 ")).toEqual({ tipo: "cliente", idCliente: 4 });
  });

  it("cualquier otra cosa es inválida, no 'sin cliente': no se cae a precio de mostrador en silencio", () => {
    for (const malo of ["0", "-1", "4.5", "04", "abc", "4;drop", "1e3"]) {
      expect(leerCabeceraCliente(malo)).toEqual({ tipo: "invalida" });
    }
  });
});

describe("exigirKiosco con cliente", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = API_KEY;
    vi.mocked(obtenerClienteDescuento).mockReset();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("sin la cabecera del cliente la sesión del aparato es la de siempre y el padrón no se consulta", async () => {
    const guardia = await exigirKiosco(peticion(CABECERAS_OK));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) {
      expect(guardia.kiosco).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
      expect(guardia.cliente).toBeNull();
    }
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("con la cabecera revalida al cliente en el padrón y lo entrega completo", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(CLIENTE);

    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO_CLIENTE]: "4" }));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) expect(guardia.cliente).toEqual(CLIENTE);
    expect(obtenerClienteDescuento).toHaveBeenCalledWith(4);
  });

  it("un id que ya no está en el padrón: 401 con código cliente (no se atiende como público general)", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(null);

    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO_CLIENTE]: "4" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ ok: false, codigo: "cliente" });
    }
  });

  it("una cabecera malformada también es 401 de cliente, sin tocar el padrón", async () => {
    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO_CLIENTE]: "4 OR 1=1" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) await expect(guardia.respuesta.json()).resolves.toMatchObject({ codigo: "cliente" });
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("la cabecera del cliente no sustituye a la del aparato ni a la API key", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(CLIENTE);

    const sinAparato = await exigirKiosco(peticion({ "x-api-key": API_KEY, [CABECERA_KIOSCO_CLIENTE]: "4" }));
    const sinLlave = await exigirKiosco(
      peticion({ [CABECERA_KIOSCO]: "piso-1|matriz", [CABECERA_KIOSCO_CLIENTE]: "4" })
    );

    expect(sinAparato.ok).toBe(false);
    expect(sinLlave.ok).toBe(false);
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("si el padrón no responde, la puerta se cierra con 502 (nunca se atiende con un descuento adivinado)", async () => {
    vi.mocked(obtenerClienteDescuento).mockRejectedValue(new Error("caída"));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});

    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO_CLIENTE]: "4" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) expect(guardia.respuesta.status).toBe(502);
    silencio.mockRestore();
  });
});

describe("exigirKioscoConCliente", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = API_KEY;
    vi.mocked(obtenerClienteDescuento).mockReset();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("con cliente entrega el aparato y el cliente del padrón", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(CLIENTE);

    const guardia = await exigirKioscoConCliente(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO_CLIENTE]: "4" }));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) {
      expect(guardia.kiosco).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
      expect(guardia.cliente.id).toBe(4);
    }
  });

  it("sin cliente: 401 con código cliente, aunque el aparato esté bien", async () => {
    const guardia = await exigirKioscoConCliente(peticion(CABECERAS_OK));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ codigo: "cliente" });
    }
  });

  it("sin API key sigue siendo el 401 de la llave, no el del cliente", async () => {
    const guardia = await exigirKioscoConCliente(peticion({ [CABECERA_KIOSCO]: "piso-1|matriz" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) await expect(guardia.respuesta.json()).resolves.toMatchObject({ codigo: "api_key" });
  });
});
