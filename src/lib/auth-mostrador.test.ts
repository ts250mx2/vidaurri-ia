import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exigirMostrador,
  firmarSesionMostrador,
  respuestaSinApiKey,
  respuestaSinSesion,
  sesionMostradorDe,
  verificarSesionMostrador,
  type SesionMostrador,
} from "./auth-mostrador";

const SECRETO = "secreto-de-pruebas-del-mostrador";

const SESION: SesionMostrador = {
  id: 7,
  usuario: "jperez",
  nombre: "Juan Pérez",
  perfil: "Ventas",
  nivel: 2,
  serie: null,
};

function peticion(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mostrador/pedidos", { headers });
}

async function firmarAjeno(opciones: { audiencia?: string }): Promise<string> {
  const jwt = new SignJWT({ ...SESION })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h");
  if (opciones.audiencia) jwt.setAudience(opciones.audiencia);
  return jwt.sign(new TextEncoder().encode(SECRETO));
}

describe("firmar y verificar sesión del mostrador", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_JWT_SECRET = SECRETO;
    process.env.MOSTRADOR_API_KEY = "key-mostrador";
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...original };
  });

  it("firma y recupera la misma sesión", async () => {
    const token = await firmarSesionMostrador(SESION);
    expect(token.split(".")).toHaveLength(3);
    await expect(verificarSesionMostrador(token)).resolves.toEqual(SESION);
  });

  it("conserva la serie cuando viene", async () => {
    const token = await firmarSesionMostrador({ ...SESION, serie: "B" });
    await expect(verificarSesionMostrador(token)).resolves.toMatchObject({ serie: "B" });
  });

  it("rechaza un token con otra audiencia (el del dashboard, por ejemplo)", async () => {
    await expect(verificarSesionMostrador(await firmarAjeno({ audiencia: "dashboard" }))).resolves.toBeNull();
    await expect(verificarSesionMostrador(await firmarAjeno({}))).resolves.toBeNull();
  });

  it("rechaza un token firmado con otro secreto", async () => {
    const token = await firmarSesionMostrador(SESION);
    process.env.MOSTRADOR_JWT_SECRET = "otro-secreto";
    await expect(verificarSesionMostrador(token)).resolves.toBeNull();
  });

  it("rechaza un token expirado (12 h después ya no sirve)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00-06:00"));
    const token = await firmarSesionMostrador(SESION);
    await expect(verificarSesionMostrador(token)).resolves.not.toBeNull();

    vi.setSystemTime(new Date("2026-09-02T21:00:01-06:00"));
    await expect(verificarSesionMostrador(token)).resolves.toBeNull();
  });

  it("rechaza basura y devuelve null sin lanzar", async () => {
    await expect(verificarSesionMostrador("no-es-un-jwt")).resolves.toBeNull();
    await expect(verificarSesionMostrador("")).resolves.toBeNull();
  });

  it("sesionMostradorDe lee solo el Bearer", async () => {
    const token = await firmarSesionMostrador(SESION);
    await expect(sesionMostradorDe(peticion({ Authorization: `Bearer ${token}` }))).resolves.toEqual(SESION);
    await expect(sesionMostradorDe(peticion({ authorization: `bearer ${token}` }))).resolves.toEqual(SESION);
    await expect(sesionMostradorDe(peticion({ Authorization: token }))).resolves.toBeNull();
    await expect(sesionMostradorDe(peticion({ Authorization: "Bearer " }))).resolves.toBeNull();
    await expect(sesionMostradorDe(peticion({}))).resolves.toBeNull();
  });

  it("exigirMostrador distingue con `codigo` la API key del Bearer, ambos 401", async () => {
    const token = await firmarSesionMostrador(SESION);

    const bien = await exigirMostrador(
      peticion({ "X-API-Key": "key-mostrador", Authorization: `Bearer ${token}` })
    );
    expect(bien.ok).toBe(true);
    if (bien.ok) expect(bien.sesion).toEqual(SESION);

    // Sin key: es un error de configuración entre servidores, no una sesión
    // vencida, y la página no debe mandar al vendedor a login por esto.
    const sinKey = await exigirMostrador(peticion({ Authorization: `Bearer ${token}` }));
    expect(sinKey.ok).toBe(false);
    if (!sinKey.ok) {
      expect(sinKey.respuesta.status).toBe(401);
      expect(await sinKey.respuesta.json()).toEqual({
        ok: false,
        error: "Servicio no autorizado",
        codigo: "api_key",
      });
    }

    // Con key mala y Bearer bueno: la key manda antes que el token.
    const keyMala = await exigirMostrador(
      peticion({ "X-API-Key": "otra-key", Authorization: `Bearer ${token}` })
    );
    expect(keyMala.ok).toBe(false);
    if (!keyMala.ok) expect(await keyMala.respuesta.json()).toMatchObject({ codigo: "api_key" });

    const sinToken = await exigirMostrador(peticion({ "X-API-Key": "key-mostrador" }));
    expect(sinToken.ok).toBe(false);
    if (!sinToken.ok) {
      expect(sinToken.respuesta.status).toBe(401);
      expect(await sinToken.respuesta.json()).toEqual({ ok: false, error: "No autorizado", codigo: "sesion" });
    }

    const tokenAjeno = await exigirMostrador(
      peticion({
        "X-API-Key": "key-mostrador",
        Authorization: `Bearer ${await firmarAjeno({ audiencia: "dashboard" })}`,
      })
    );
    expect(tokenAjeno.ok).toBe(false);
    if (!tokenAjeno.ok) expect(await tokenAjeno.respuesta.json()).toMatchObject({ codigo: "sesion" });
  });

  it("respuestaSinApiKey y respuestaSinSesion son las que usa la guardia (y el login)", async () => {
    expect(respuestaSinApiKey().status).toBe(401);
    expect(await respuestaSinApiKey().json()).toMatchObject({ ok: false, codigo: "api_key" });
    expect(respuestaSinSesion().status).toBe(401);
    expect(await respuestaSinSesion().json()).toMatchObject({ ok: false, codigo: "sesion" });
  });
});
