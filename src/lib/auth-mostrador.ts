import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { apiKeyValida } from "@/lib/api-key";
import { perfilDe, type PerfilPos } from "@/lib/pedidos";

// Sesión del vendedor en el mostrador (vidaurri-page). Es un JWT aparte del de
// la cookie del dashboard (`auth.ts`): distinto secreto (MOSTRADOR_JWT_SECRET,
// compartido con vidaurri-page para que verifique localmente) y audiencia
// "mostrador", de modo que un token del dashboard nunca abra el mostrador ni
// al revés.

export interface SesionMostrador {
  id: number;
  usuario: string;
  nombre: string;
  perfil: PerfilPos;
  nivel: number;
  serie: string | null;
}

export const AUDIENCIA_MOSTRADOR = "mostrador";
export const DURACION_SESION_MOSTRADOR = "12h";
/** Misma vida que el JWT, para que quien guarde el token sepa cuánto dura. */
export const DURACION_SESION_MOSTRADOR_MS = 12 * 60 * 60 * 1000;

function claveSecreta(): Uint8Array {
  const secreto = process.env.MOSTRADOR_JWT_SECRET;
  if (!secreto) throw new Error("Falta MOSTRADOR_JWT_SECRET en las variables de entorno.");
  return new TextEncoder().encode(secreto);
}

/** Firma el JWT del mostrador (HS256, audiencia "mostrador", 12 h). */
export async function firmarSesionMostrador(sesion: SesionMostrador): Promise<string> {
  return new SignJWT({ ...sesion })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCIA_MOSTRADOR)
    .setIssuedAt()
    .setExpirationTime(DURACION_SESION_MOSTRADOR)
    .sign(claveSecreta());
}

/** Verifica un token del mostrador; null si es inválido, expirado o de otra audiencia. */
export async function verificarSesionMostrador(token: string): Promise<SesionMostrador | null> {
  try {
    const { payload } = await jwtVerify(token, claveSecreta(), {
      audience: AUDIENCIA_MOSTRADOR,
      algorithms: ["HS256"],
    });
    return {
      id: Number(payload.id),
      usuario: String(payload.usuario),
      nombre: String(payload.nombre),
      // Se vuelve a normalizar: el token lo firmamos nosotros, pero el perfil
      // decide permisos y no cuesta nada no confiar en el payload a ciegas.
      perfil: perfilDe({ perfil: String(payload.perfil ?? "") }),
      nivel: Number(payload.nivel),
      serie: payload.serie == null ? null : String(payload.serie),
    };
  } catch {
    return null;
  }
}

/** Lee `Authorization: Bearer <token>` y devuelve la sesión, o null. */
export async function sesionMostradorDe(request: Request): Promise<SesionMostrador | null> {
  const cabecera = request.headers.get("authorization") ?? "";
  if (!cabecera.toLowerCase().startsWith("bearer ")) return null;
  const token = cabecera.slice(7).trim();
  if (!token) return null;
  return verificarSesionMostrador(token);
}

export type ResultadoExigirMostrador =
  | { ok: true; sesion: SesionMostrador }
  | { ok: false; respuesta: NextResponse };

/**
 * Qué capa rechazó la petición. `api_key` = la llave servidor→servidor de
 * vidaurri-page no vino o no coincide (error de configuración: la página no
 * debe tratarlo como sesión vencida ni mandar al vendedor a login); `sesion` =
 * el Bearer del vendedor falta, venció o es de otra audiencia.
 */
export type CodigoNoAutorizado = "api_key" | "sesion";

/** 401 cuando falla la API key de vidaurri-page. Solo la página ve esta respuesta. */
export function respuestaSinApiKey(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Servicio no autorizado", codigo: "api_key" satisfies CodigoNoAutorizado },
    { status: 401 }
  );
}

/** 401 cuando falla el Bearer del vendedor (sin sesión, vencida o ajena). */
export function respuestaSinSesion(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "No autorizado", codigo: "sesion" satisfies CodigoNoAutorizado },
    { status: 401 }
  );
}

/**
 * Guardia estándar de toda ruta /api/mostrador/* (salvo login): primero la API
 * key de vidaurri-page, luego el Bearer del vendedor. Los dos fallos son 401,
 * pero con `codigo` distinto: si la página confundiera una key rotada con una
 * sesión vencida, mandaría al vendedor a login con una cookie que sigue
 * pasando su verificación local y lo dejaría en un bucle de redirecciones.
 */
export async function exigirMostrador(request: Request): Promise<ResultadoExigirMostrador> {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) return { ok: false, respuesta: respuestaSinApiKey() };
  const sesion = await sesionMostradorDe(request);
  if (!sesion) return { ok: false, respuesta: respuestaSinSesion() };
  return { ok: true, sesion };
}
