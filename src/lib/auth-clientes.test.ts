import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CABECERA_CLIENTE, exigirCliente } from "./auth-clientes";
import { CABECERA_KIOSCO, CABECERA_KIOSCO_CLIENTE } from "./auth-kiosco";
import { firmarSesionMostrador } from "./auth-mostrador";
import type { ClienteDescuento } from "./clientes-descuento";
import { obtenerClienteDescuento } from "./db-clientes-descuento";

// El área de clientes no depende del kiosco ni del mostrador: la credencial es
// la API key de vidaurri-page más la cabecera X-Cliente con el id del cliente
// que entró (su cookie la firma la página; el motor solo confía en el id, y
// solo si el padrón lo sigue teniendo). Ni el JWT del mostrador ni la
// cabecera del kiosco abren esta puerta.

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
  permitirPedido: true,
  creadoPor: null,
  creadoEn: "2026-09-01 10:00:00",
  actualizadoPor: null,
  actualizadoEn: "2026-09-01 10:00:00",
};

function peticion(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/clientes/borrador", { headers });
}

const CABECERAS_OK = { "x-api-key": API_KEY, [CABECERA_CLIENTE]: "4" };

async function codigoDe(guardia: Awaited<ReturnType<typeof exigirCliente>>): Promise<unknown> {
  if (guardia.ok) return "ok";
  return { status: guardia.respuesta.status, ...(await guardia.respuesta.json()) };
}

describe("exigirCliente", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = API_KEY;
    process.env.MOSTRADOR_JWT_SECRET = "secreto-de-pruebas-del-mostrador";
    vi.mocked(obtenerClienteDescuento).mockReset();
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(CLIENTE);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("deja pasar con API key y X-Cliente, revalidando al cliente en el padrón", async () => {
    const guardia = await exigirCliente(peticion(CABECERAS_OK));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) expect(guardia.cliente).toEqual(CLIENTE);
    expect(obtenerClienteDescuento).toHaveBeenCalledWith(4);
  });

  it("sin API key: 401 con código api_key, sin ir al padrón", async () => {
    const guardia = await exigirCliente(peticion({ [CABECERA_CLIENTE]: "4" }));

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, ok: false, codigo: "api_key" });
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("sin la variable configurada la puerta queda cerrada", async () => {
    delete process.env.MOSTRADOR_API_KEY;
    expect((await exigirCliente(peticion(CABECERAS_OK))).ok).toBe(false);
  });

  it("sin X-Cliente: 401 con código cliente (la página lo manda a entrar)", async () => {
    const guardia = await exigirCliente(peticion({ "x-api-key": API_KEY }));

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, codigo: "cliente" });
  });

  it("con X-Cliente malformado también es 401 de cliente, sin consultar el padrón", async () => {
    for (const malo of ["0", "-4", "4.5", "04", "abc", "4; DROP"]) {
      const guardia = await exigirCliente(peticion({ ...CABECERAS_OK, [CABECERA_CLIENTE]: malo }));
      expect(await codigoDe(guardia), malo).toMatchObject({ status: 401, codigo: "cliente" });
    }
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("un id que ya no está en el padrón: 401 de cliente", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue(null);

    const guardia = await exigirCliente(peticion(CABECERAS_OK));

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, codigo: "cliente" });
  });

  it("un cliente del padrón que se quedó sin celular no puede operar (su borrador es c:<celular>)", async () => {
    vi.mocked(obtenerClienteDescuento).mockResolvedValue({ ...CLIENTE, telefono: null, telefonos: [] });

    const guardia = await exigirCliente(peticion(CABECERAS_OK));

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, codigo: "cliente" });
  });

  it("si el padrón no responde, 502 (no se atiende a ciegas)", async () => {
    vi.mocked(obtenerClienteDescuento).mockRejectedValue(new Error("ECONNREFUSED"));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});

    const guardia = await exigirCliente(peticion(CABECERAS_OK));

    expect(await codigoDe(guardia)).toMatchObject({ status: 502 });
    silencio.mockRestore();
  });

  it("NUNCA acepta el JWT del mostrador en lugar de X-Cliente", async () => {
    const token = await firmarSesionMostrador({
      id: 7,
      usuario: "jperez",
      nombre: "Juan Pérez",
      perfil: "Administrador",
      nivel: 1,
      serie: null,
    });

    const guardia = await exigirCliente(peticion({ "x-api-key": API_KEY, authorization: `Bearer ${token}` }));

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, codigo: "cliente" });
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });

  it("NUNCA acepta las cabeceras del kiosco (X-Kiosco / X-Kiosco-Cliente) en lugar de X-Cliente", async () => {
    const guardia = await exigirCliente(
      peticion({ "x-api-key": API_KEY, [CABECERA_KIOSCO]: "piso-1|matriz", [CABECERA_KIOSCO_CLIENTE]: "4" })
    );

    expect(await codigoDe(guardia)).toMatchObject({ status: 401, codigo: "cliente" });
    expect(obtenerClienteDescuento).not.toHaveBeenCalled();
  });
});
