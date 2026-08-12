import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { SesionUsuario } from "@/types";

export const COOKIE_SESION = "vidaurri_sesion";
const DURACION_SESION = "12h";

function claveSecreta(): Uint8Array {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error("Falta JWT_SECRET en las variables de entorno.");
  return new TextEncoder().encode(secreto);
}

/** Firma el JWT de sesión con los datos del usuario. */
export async function firmarSesion(usuario: SesionUsuario): Promise<string> {
  return new SignJWT({ ...usuario })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACION_SESION)
    .sign(claveSecreta());
}

/** Verifica un JWT y devuelve el usuario, o null si es inválido/expirado. */
export async function verificarSesion(token: string): Promise<SesionUsuario | null> {
  try {
    const { payload } = await jwtVerify(token, claveSecreta());
    return {
      id: Number(payload.id),
      usuario: String(payload.usuario),
      nombre: String(payload.nombre),
      perfil: String(payload.perfil),
      nivel: Number(payload.nivel),
      serie: payload.serie == null ? null : String(payload.serie),
    };
  } catch {
    return null;
  }
}

/** Lee la sesión desde la cookie (para API routes / server components). */
export async function sesionActual(): Promise<SesionUsuario | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESION)?.value;
  if (!token) return null;
  return verificarSesion(token);
}
