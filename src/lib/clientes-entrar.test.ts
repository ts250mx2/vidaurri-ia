import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClienteDescuento } from "./clientes-descuento";
import { hashPassword, verificarPassword } from "./clientes-acceso";
import {
  ERROR_ENTRADA_CLIENTE,
  ERROR_LIMITE_ENTRADAS,
  ERROR_PASSWORD_ACTUAL,
  ERROR_SIN_ACCESO,
  cambiarPasswordCliente,
  entrarCliente,
} from "./clientes-entrar";
import { cambiarPassword, crearAccesoPorDefecto, obtenerAcceso, registrarAcceso } from "./db-clientes-acceso";
import type { ClienteAcceso } from "./db-clientes-acceso";
import { obtenerClienteDescuentoPorTelefono } from "./db-clientes-descuento";
import type { RegistroIntentos } from "./limite-intentos";

// Entrar al área de clientes. Lo que no puede fallar: la primera vez la
// contraseña es el celular y ahí se crea la fila; una vez cambiada, la vieja
// ya no abre; "no estás en el padrón" y "contraseña mala" son la MISMA
// respuesta (para no regalar quién es cliente); y los topes por usuario y por
// IP frenan la fuerza bruta igual que en el login del mostrador.

vi.mock("./db-clientes-descuento", () => ({ obtenerClienteDescuentoPorTelefono: vi.fn() }));
vi.mock("./db-clientes-acceso", () => ({
  obtenerAcceso: vi.fn(),
  crearAccesoPorDefecto: vi.fn(),
  cambiarPassword: vi.fn(),
  registrarAcceso: vi.fn(),
}));

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

const T0 = 1_000_000;

function acceso(passwordHash: string, passwordPorDefecto: boolean): ClienteAcceso {
  return {
    idCliente: 4,
    telefono: "8112345678",
    usuario: "8112345678",
    passwordHash,
    passwordPorDefecto,
    creadoEn: "2026-09-15 09:00:00",
    cambiadoEn: passwordPorDefecto ? null : "2026-09-15 09:30:00",
    ultimoAcceso: null,
  };
}

const porTelefono = vi.mocked(obtenerClienteDescuentoPorTelefono);
const leerAcceso = vi.mocked(obtenerAcceso);
const crearAcceso = vi.mocked(crearAccesoPorDefecto);
const guardarPassword = vi.mocked(cambiarPassword);
const anotarAcceso = vi.mocked(registrarAcceso);

let registro: RegistroIntentos;

function entrar(usuario: string, password: string, ip: string | null = null, ahora = T0) {
  return entrarCliente({ usuario, password }, { ip, registro, ahora });
}

beforeEach(() => {
  registro = new Map();
  porTelefono.mockReset();
  leerAcceso.mockReset();
  crearAcceso.mockReset();
  guardarPassword.mockReset();
  anotarAcceso.mockReset();
  porTelefono.mockResolvedValue(CLIENTE);
  leerAcceso.mockResolvedValue(null);
  anotarAcceso.mockResolvedValue();
});

afterEach(() => vi.clearAllMocks());

describe("entrarCliente — primer acceso", () => {
  it("sin fila en clientes_acceso, la contraseña válida es el celular: crea la fila y entra", async () => {
    crearAcceso.mockImplementation(async () => acceso(await hashPassword("8112345678"), true));

    const r = await entrar("81 1234 5678", "8112345678");

    expect(r).toEqual({
      ok: true,
      cliente: CLIENTE,
      sesion: {
        idCliente: 4,
        nombre: "Taller López",
        telefono: "8112345678",
        descuento: 38,
        permitirPedido: true,
        passwordPorDefecto: true,
      },
    });
    expect(crearAcceso).toHaveBeenCalledWith(CLIENTE, "8112345678");
    expect(anotarAcceso).toHaveBeenCalledWith(4);
  });

  it("sin fila y con otra contraseña: 401 y NO crea la fila", async () => {
    const r = await entrar("8112345678", "otra-cosa");

    expect(r).toEqual({ ok: false, status: 401, error: ERROR_ENTRADA_CLIENTE });
    expect(crearAcceso).not.toHaveBeenCalled();
    expect(anotarAcceso).not.toHaveBeenCalled();
  });
});

describe("entrarCliente — contraseña propia", () => {
  it("con la fila, verifica contra el hash y ya no marca contraseña por defecto", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));

    const r = await entrar("8112345678", "Taller2026");

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sesion.passwordPorDefecto).toBe(false);
    expect(crearAcceso).not.toHaveBeenCalled();
    expect(anotarAcceso).toHaveBeenCalledWith(4);
  });

  it("una vez cambiada, el celular (la contraseña vieja) ya no abre", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));

    const r = await entrar("8112345678", "8112345678");

    expect(r).toEqual({ ok: false, status: 401, error: ERROR_ENTRADA_CLIENTE });
  });
});

describe("entrarCliente — la misma respuesta para quien no está y para la contraseña mala", () => {
  it("no está en el padrón y contraseña incorrecta son idénticos (status, texto y forma)", async () => {
    porTelefono.mockResolvedValueOnce(null);
    const noEsta = await entrar("8100000000", "8100000000");

    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));
    const passwordMala = await entrar("8112345678", "nope-nope");

    expect(noEsta).toEqual(passwordMala);
    expect(noEsta).toEqual({ ok: false, status: 401, error: ERROR_ENTRADA_CLIENTE });
  });

  it("un cuerpo mal formado es 400, antes de tocar el padrón", async () => {
    const r = await entrarCliente({ usuario: "juan", password: "x" }, { ip: null, registro, ahora: T0 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(porTelefono).not.toHaveBeenCalled();
  });
});

describe("entrarCliente — topes", () => {
  it("5 fallos del mismo usuario en 10 minutos: el sexto es 429 sin consultar la base", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));
    for (let i = 0; i < 5; i++) {
      const r = await entrar("8112345678", "mala", null, T0 + i);
      expect(r).toMatchObject({ ok: false, status: 401 });
    }
    porTelefono.mockClear();

    const sexto = await entrar("8112345678", "Taller2026", null, T0 + 10);

    expect(sexto).toEqual({ ok: false, status: 429, error: ERROR_LIMITE_ENTRADAS });
    expect(porTelefono).not.toHaveBeenCalled();
  });

  it("los fallos vencen a los 10 minutos", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));
    for (let i = 0; i < 5; i++) await entrar("8112345678", "mala", null, T0 + i);

    const despues = await entrar("8112345678", "Taller2026", null, T0 + 10 * 60 * 1000 + 100);

    expect(despues.ok).toBe(true);
  });

  it("5 fallos desde la misma IP sobre usuarios distintos también frenan (rociado)", async () => {
    porTelefono.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      await entrar(`811000000${i}`, "x", "10.0.0.9", T0 + i);
    }

    const otro = await entrar("8119999999", "x", "10.0.0.9", T0 + 10);

    expect(otro).toEqual({ ok: false, status: 429, error: ERROR_LIMITE_ENTRADAS });
  });

  it("sin IP, los fallos sobre usuarios distintos van al cubo compartido (tope alto, no 5)", async () => {
    porTelefono.mockResolvedValue(null);
    for (let i = 0; i < 6; i++) await entrar(`811000000${i}`, "x", null, T0 + i);

    const otro = await entrar("8119999999", "x", null, T0 + 10);

    expect(otro).toMatchObject({ ok: false, status: 401 });
  });

  it("entrar bien limpia el cubo del usuario y el de su IP", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("Taller2026"), false));
    for (let i = 0; i < 4; i++) await entrar("8112345678", "mala", "10.0.0.9", T0 + i);

    expect((await entrar("8112345678", "Taller2026", "10.0.0.9", T0 + 5)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await entrar("8112345678", "mala", "10.0.0.9", T0 + 10 + i);
    const quinto = await entrar("8112345678", "Taller2026", "10.0.0.9", T0 + 20);

    expect(quinto.ok).toBe(true);
  });
});

describe("entrarCliente — la base no responde", () => {
  it("si el padrón falla, 502 y no cuenta como intento fallido", async () => {
    porTelefono.mockRejectedValue(new Error("ECONNREFUSED"));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await entrar("8112345678", "8112345678");

    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(registro.size).toBe(0);
    silencio.mockRestore();
  });
});

describe("cambiarPasswordCliente", () => {
  it("verifica la actual, guarda un hash nuevo de la nueva y deja de ser por defecto", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("8112345678"), true));
    guardarPassword.mockResolvedValue();

    const r = await cambiarPasswordCliente(CLIENTE, { actual: "8112345678", nueva: "Taller2026" });

    expect(r).toEqual({ ok: true });
    expect(guardarPassword).toHaveBeenCalledTimes(1);
    const [id, hash] = guardarPassword.mock.calls[0];
    expect(id).toBe(4);
    expect(hash).not.toContain("Taller2026");
    await expect(verificarPassword("Taller2026", hash)).resolves.toBe(true);
  });

  it("con la actual equivocada: 401 y no guarda nada", async () => {
    leerAcceso.mockResolvedValue(acceso(await hashPassword("8112345678"), true));

    const r = await cambiarPasswordCliente(CLIENTE, { actual: "otra", nueva: "Taller2026" });

    expect(r).toEqual({ ok: false, status: 401, error: ERROR_PASSWORD_ACTUAL });
    expect(guardarPassword).not.toHaveBeenCalled();
  });

  it("con la nueva inválida: 400 con el motivo, antes de verificar la actual", async () => {
    const r = await cambiarPasswordCliente(CLIENTE, { actual: "8112345678", nueva: "8112345678" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(leerAcceso).not.toHaveBeenCalled();
  });

  it("sin fila de acceso (nunca entró o se la borraron): 409, que vuelva a entrar", async () => {
    const r = await cambiarPasswordCliente(CLIENTE, { actual: "8112345678", nueva: "Taller2026" });

    expect(r).toEqual({ ok: false, status: 409, error: ERROR_SIN_ACCESO });
  });
});
