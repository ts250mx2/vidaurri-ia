import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firmarSesion, verificarSesion } from "./auth";
import { firmarSesionMostrador } from "./auth-mostrador";
import type { SesionUsuario } from "@/types";

const SECRETO = "secreto-de-pruebas-del-dashboard";

const USUARIO: SesionUsuario = {
  id: 7,
  usuario: "jperez",
  nombre: "Juan Pérez",
  perfil: "Ventas",
  nivel: 2,
  serie: null,
};

describe("sesión del dashboard", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.JWT_SECRET = SECRETO;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("firma y recupera la misma sesión", async () => {
    await expect(verificarSesion(await firmarSesion(USUARIO))).resolves.toEqual(USUARIO);
  });

  it("rechaza el token del mostrador aunque comparta secreto", async () => {
    // El aislamiento no debe depender de que MOSTRADOR_JWT_SECRET sea distinto.
    process.env.MOSTRADOR_JWT_SECRET = SECRETO;
    const token = await firmarSesionMostrador({ ...USUARIO, perfil: "Ventas" });
    await expect(verificarSesion(token)).resolves.toBeNull();
  });

  it("rechaza cualquier token con audiencia y cualquier algoritmo que no sea HS256", async () => {
    const clave = new TextEncoder().encode(SECRETO);
    const conAudiencia = await new SignJWT({ ...USUARIO })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("otra")
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(clave);
    await expect(verificarSesion(conAudiencia)).resolves.toBeNull();

    const otroAlgoritmo = await new SignJWT({ ...USUARIO })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(clave);
    await expect(verificarSesion(otroAlgoritmo)).resolves.toBeNull();
  });

  it("rechaza otro secreto y basura sin lanzar", async () => {
    const token = await firmarSesion(USUARIO);
    process.env.JWT_SECRET = "otro";
    await expect(verificarSesion(token)).resolves.toBeNull();
    await expect(verificarSesion("no-es-un-jwt")).resolves.toBeNull();
  });
});
