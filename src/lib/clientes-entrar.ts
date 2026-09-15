import { comparaSecretoSeguro } from "@/lib/api-key";
import {
  clienteParaSesion,
  hashPassword,
  validarCambioPassword,
  validarCredenciales,
  validarNuevaPassword,
  verificarPassword,
  type ClienteSesion,
} from "@/lib/clientes-acceso";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import { cambiarPassword, crearAccesoPorDefecto, obtenerAcceso, registrarAcceso } from "@/lib/db-clientes-acceso";
import { obtenerClienteDescuentoPorTelefono } from "@/lib/db-clientes-descuento";
import {
  CLAVE_SIN_IP,
  LIMITE_SIN_IP,
  algunCuboExcede,
  cubosDeLogin,
  limpiarIntentos,
  podarIntentos,
  registrarEnCubos,
  type RegistroIntentos,
} from "@/lib/limite-intentos";

// Entrar al área de clientes y cambiar la contraseña. Lo comparten
// POST /api/clientes/entrar (el cliente en su dispositivo) y
// POST /api/kiosco/cliente/entrar (la PC de la tienda): es la MISMA cuenta.
//
// Reglas:
// - El usuario es el celular del padrón. La primera vez la contraseña es ese
//   mismo celular; al entrar así se crea la fila en clientes_acceso (con hash)
//   y la página le sugiere cambiarla.
// - "No está en el padrón" y "contraseña mala" responden EXACTAMENTE lo mismo
//   (401, mismo texto), para no regalar quién es cliente. Y cuestan parecido:
//   cuando no hay cliente se verifica contra un hash señuelo.
// - Topes calcados del login del mostrador: 5 intentos por usuario y 5 por IP
//   confiable cada 10 minutos; sin IP, un cubo compartido con tope alto.

export const ERROR_ENTRADA_CLIENTE = "Celular o contraseña incorrectos";
export const ERROR_LIMITE_ENTRADAS = "Demasiados intentos; espera unos minutos";
export const ERROR_PASSWORD_ACTUAL = "La contraseña actual no es correcta";
export const ERROR_SIN_ACCESO = "Vuelve a entrar con tu celular para poder cambiar tu contraseña";
const ERROR_BASE = "No fue posible consultar la base de datos";
const CADA_CUANTO_PODAR = 200; // peticiones entre podas del registro

// Intentos fallidos por usuario y por IP, en memoria del proceso (como el
// login del mostrador: un solo servidor interno).
const intentos: RegistroIntentos = new Map();
let contadorPeticiones = 0;

// Hash contra el que se verifica cuando el celular no está en el padrón, para
// que ese camino tarde lo mismo que una contraseña mala. Se calcula una vez.
let senuelo: Promise<string> | null = null;
function hashSenuelo(): Promise<string> {
  senuelo ??= hashPassword("senuelo-sin-cliente");
  return senuelo;
}

/** El celular en el log, sin regalarlo entero. */
function ocultar(usuario: string): string {
  return `***${usuario.slice(-4)}`;
}

/**
 * IP del cliente: solo la que vidaurri-page manda en `x-cliente-ip`, y la
 * página solo la manda cuando tiene un proxy inverso declarado (CONFIAR_XFF;
 * viene con la API key, así que es de fiar). No se lee `x-forwarded-for`: sin
 * proxy ese header lo escribe el propio navegador y serviría para vaciar el
 * cubo por IP a voluntad. Sin IP se usa el cubo compartido con tope alto.
 */
export function ipClienteDe(request: Request): string | null {
  const propia = request.headers.get("x-cliente-ip")?.trim();
  return propia || null;
}

export interface OpcionesEntrada {
  /** IP confiable (la que vidaurri-page manda en x-cliente-ip) o null. */
  ip: string | null;
  /** Registro y reloj inyectables para las pruebas. */
  registro?: RegistroIntentos;
  ahora?: number;
}

export type ResultadoEntrada =
  | { ok: true; sesion: ClienteSesion; cliente: ClienteDescuento }
  | { ok: false; status: 400 | 401 | 429 | 502; error: string };

/** ¿La contraseña abre la cuenta? Sin fila, la válida es el celular y se crea
 *  la fila; con fila, se verifica contra el hash. Devuelve si sigue siendo la
 *  por defecto, o null si no abrió. */
async function abrirCuenta(cliente: ClienteDescuento, usuario: string, password: string): Promise<boolean | null> {
  const acceso = await obtenerAcceso(cliente.id);
  if (!acceso) {
    if (!comparaSecretoSeguro(password, usuario)) return null;
    const creado = await crearAccesoPorDefecto(cliente, usuario);
    return creado.passwordPorDefecto;
  }
  if (!(await verificarPassword(password, acceso.passwordHash))) return null;
  return acceso.passwordPorDefecto;
}

export async function entrarCliente(cuerpo: unknown, opciones: OpcionesEntrada): Promise<ResultadoEntrada> {
  const validacion = validarCredenciales(cuerpo);
  if (!validacion.ok) return { ok: false, status: 400, error: validacion.error };
  const { usuario, password } = validacion.datos;

  const registro = opciones.registro ?? intentos;
  const ahora = opciones.ahora ?? Date.now();
  const cubos = cubosDeLogin(usuario, opciones.ip);

  if (++contadorPeticiones % CADA_CUANTO_PODAR === 0) podarIntentos(registro, LIMITE_SIN_IP, ahora);
  if (algunCuboExcede(registro, cubos, ahora)) {
    console.warn("[clientes-entrar] límite", ocultar(usuario), opciones.ip ?? "sin-ip");
    return { ok: false, status: 429, error: ERROR_LIMITE_ENTRADAS };
  }

  let cliente: ClienteDescuento | null;
  let passwordPorDefecto: boolean | null;
  try {
    cliente = await obtenerClienteDescuentoPorTelefono(usuario);
    passwordPorDefecto = cliente
      ? await abrirCuenta(cliente, usuario, password)
      : await verificarPassword(password, await hashSenuelo()).then(() => null);
  } catch (error) {
    console.error("[clientes-entrar] error de base", error);
    return { ok: false, status: 502, error: ERROR_BASE };
  }

  if (!cliente || passwordPorDefecto === null) {
    console.warn("[clientes-entrar] fallo", ocultar(usuario), opciones.ip ?? "sin-ip");
    registrarEnCubos(registro, cubos, ahora);
    return { ok: false, status: 401, error: ERROR_ENTRADA_CLIENTE };
  }

  // Solo informativo: si no se pudo anotar, el cliente entra igual.
  await registrarAcceso(cliente.id).catch((error) => {
    console.error(`[clientes-entrar] anotando el acceso del cliente #${cliente?.id}:`, error);
  });
  // Se olvidan la cuenta y la IP propia; el cubo compartido sigue contando
  // para que un acierto no le abra la puerta al rociado sobre las demás.
  for (const cubo of cubos) {
    if (cubo.clave !== CLAVE_SIN_IP) limpiarIntentos(registro, cubo.clave);
  }
  return { ok: true, cliente, sesion: clienteParaSesion(cliente, usuario, passwordPorDefecto) };
}

export type ResultadoCambioPassword =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 409 | 502; error: string };

/**
 * Cambia la contraseña del cliente de la sesión: verifica la actual contra el
 * hash, valida la nueva (8..64, sin espacios en las puntas, distinta de su
 * celular) y guarda el hash nuevo; desde ahí deja de ser la por defecto.
 */
export async function cambiarPasswordCliente(cliente: ClienteDescuento, cuerpo: unknown): Promise<ResultadoCambioPassword> {
  const validacion = validarCambioPassword(cuerpo, cliente.telefono ?? "");
  if (!validacion.ok) return { ok: false, status: 400, error: validacion.error };
  const { actual, nueva } = validacion.datos;

  try {
    const acceso = await obtenerAcceso(cliente.id);
    if (!acceso) return { ok: false, status: 409, error: ERROR_SIN_ACCESO };
    // La cuenta pudo crearse con otro de sus celulares: tampoco puede ser ese.
    if (acceso.telefono !== cliente.telefono) {
      const contraLaCuenta = validarNuevaPassword(nueva, acceso.telefono);
      if (!contraLaCuenta.ok) return { ok: false, status: 400, error: contraLaCuenta.error };
    }
    if (!(await verificarPassword(actual, acceso.passwordHash))) {
      return { ok: false, status: 401, error: ERROR_PASSWORD_ACTUAL };
    }
    await cambiarPassword(cliente.id, await hashPassword(nueva));
    return { ok: true };
  } catch (error) {
    console.error(`[clientes-entrar] cambiando la contraseña del cliente #${cliente.id}:`, error);
    return { ok: false, status: 502, error: ERROR_BASE };
  }
}
