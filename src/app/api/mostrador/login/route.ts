import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { apiKeyValida, comparaSecretoSeguro } from "@/lib/api-key";
import {
  DURACION_SESION_MOSTRADOR_MS,
  firmarSesionMostrador,
  respuestaSinApiKey,
  type SesionMostrador,
} from "@/lib/auth-mostrador";
import { perfilDe } from "@/lib/pedidos";
import {
  algunCuboExcede,
  CLAVE_SIN_IP,
  cubosDeLogin,
  limpiarIntentos,
  LIMITE_SIN_IP,
  podarIntentos,
  registrarEnCubos,
  type CuboIntentos,
  type RegistroIntentos,
} from "@/lib/limite-intentos";

// Login del mostrador (vidaurri-page). La página nunca ve bdav: manda usuario y
// clave aquí con su API key, y se lleva un JWT propio (audiencia "mostrador")
// que después presenta como Bearer en el resto de /api/mostrador/*. Mismo
// padrón de usuarios que el dashboard; distinto token.

export const dynamic = "force-dynamic";

const ERROR_CREDENCIALES = "Usuario o contraseña incorrectos";
const ERROR_LIMITE = "Demasiados intentos; espera unos minutos";
const CADA_CUANTO_PODAR = 200; // peticiones entre podas del registro

// Intentos fallidos por usuario y por IP, en memoria del proceso.
const intentos: RegistroIntentos = new Map();
let contadorPeticiones = 0;

interface FilaUsuario {
  id: number;
  usuario: string;
  claveUsr: string | null;
  nombre: string;
  perfil: string;
  nivel: number;
  serie: string | null;
}

type CuerpoLogin = { usuario: string; clave: string };

/**
 * IP del vendedor: solo la que vidaurri-page manda en `x-mostrador-ip`, y la
 * página solo la manda cuando tiene un proxy inverso declarado (viene con la
 * API key, así que es de fiar). No se lee `x-forwarded-for`: sin proxy ese
 * header lo escribe el propio navegador y serviría para vaciar el cubo por IP
 * a voluntad. Sin IP se usa el cubo compartido con tope alto (ver cubosDeLogin).
 */
function ipDe(request: Request): string | null {
  const propia = request.headers.get("x-mostrador-ip")?.trim();
  return propia || null;
}

function validarCuerpo(entrada: unknown): { ok: true; datos: CuerpoLogin } | { ok: false; error: string } {
  if (typeof entrada !== "object" || entrada === null) return { ok: false, error: "Petición inválida" };
  const { usuario, clave } = entrada as { usuario?: unknown; clave?: unknown };
  const usuarioLimpio = typeof usuario === "string" ? usuario.trim() : "";
  const claveTexto = typeof clave === "string" ? clave : "";
  if (!usuarioLimpio || !claveTexto) return { ok: false, error: "Usuario y contraseña son obligatorios" };
  return { ok: true, datos: { usuario: usuarioLimpio, clave: claveTexto } };
}

function credencialesIncorrectas(usuario: string, ip: string | null, cubos: CuboIntentos[]): NextResponse {
  console.warn("[mostrador-login] fallo", usuario, ip ?? "sin-ip");
  registrarEnCubos(intentos, cubos);
  return NextResponse.json({ ok: false, error: ERROR_CREDENCIALES }, { status: 401 });
}

export async function POST(request: Request) {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) return respuestaSinApiKey();

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarCuerpo(cuerpo);
  if (!validacion.ok) {
    return NextResponse.json({ ok: false, error: validacion.error }, { status: 400 });
  }
  const { usuario, clave } = validacion.datos;
  const ip = ipDe(request);
  const cubos = cubosDeLogin(usuario, ip);

  // Todos los cubos comparten ventana; se poda con la más amplia por si algún
  // día dejan de coincidir.
  if (++contadorPeticiones % CADA_CUANTO_PODAR === 0) podarIntentos(intentos, LIMITE_SIN_IP);
  if (algunCuboExcede(intentos, cubos)) {
    console.warn("[mostrador-login] límite", usuario, ip ?? "sin-ip");
    return NextResponse.json({ ok: false, error: ERROR_LIMITE }, { status: 429 });
  }

  let fila: FilaUsuario | undefined;
  try {
    // Mismo SQL que el login del dashboard: la clave se compara aquí y no en el
    // WHERE porque la colación del POS es case-insensitive y PAD SPACE.
    const filas = await consultaBdav<FilaUsuario>(
      `SELECT id, usuario, clave_usr AS claveUsr, nombre, perfil, nivel, serie
         FROM usuarios
        WHERE usuario = ?
        LIMIT 1`,
      [usuario]
    );
    fila = filas[0];
  } catch (error) {
    console.error("[mostrador-login] error de base", error);
    return NextResponse.json(
      { ok: false, error: "No fue posible conectar a la base de datos" },
      { status: 502 }
    );
  }

  if (!fila || !fila.claveUsr || !comparaSecretoSeguro(clave, fila.claveUsr)) {
    return credencialesIncorrectas(usuario, ip, cubos);
  }

  const sesion: SesionMostrador = {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    perfil: perfilDe(fila),
    nivel: fila.nivel,
    serie: fila.serie,
  };
  const token = await firmarSesionMostrador(sesion);
  // Se olvidan la cuenta y la IP propia (para no castigar al que ya entró); el
  // cubo compartido sigue contando para que un acierto en una cuenta conocida
  // no le abra la puerta al rociado sobre las demás.
  for (const cubo of cubos) {
    if (cubo.clave !== CLAVE_SIN_IP) limpiarIntentos(intentos, cubo.clave);
  }
  const expiraEn = new Date(Date.now() + DURACION_SESION_MOSTRADOR_MS).toISOString();

  return NextResponse.json({ ok: true, token, sesion, expiraEn });
}
