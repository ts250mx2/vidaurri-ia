import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import { normalizarTelefono } from "@/lib/telefono";

// La cuenta del cliente del padrón: entra con su celular (el usuario) y una
// contraseña que la primera vez es el mismo celular. Lógica pura: el hash y
// su verificación, las validaciones de los bordes y la proyección de lo que
// la página firma en su cookie. La persistencia está en db-clientes-acceso.ts
// y el flujo de entrar en clientes-entrar.ts.
//
// Contraseñas: scrypt de node:crypto (nada que instalar), sal aleatoria de
// 16 bytes, N=16384, formato guardado 'scrypt$<sal hex>$<hash hex>'. Jamás se
// guarda, devuelve ni loguea la contraseña en claro: el POS guarda las suyas
// en claro y aquí no se repite ese error.

/** Largo máximo de cualquier contraseña (la tecleada y la nueva). */
export const PASSWORD_MAX = 64;
/** Una contraseña propia tiene que ser al menos así de larga. */
export const PASSWORD_NUEVA_MIN = 8;

const SAL_BYTES = 16;
const HASH_BYTES = 64;
/** Costo de scrypt. 16384·8·128 = 16 MB por hash, debajo del maxmem por defecto de Node (32 MB). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const ALGORITMO = "scrypt";
const HEX = /^[0-9a-f]+$/;

export const ERROR_CREDENCIALES_CLIENTE = "Escribe tu celular a 10 dígitos y tu contraseña";
export const ERROR_PASSWORD_NUEVA_LARGO = `La contraseña nueva debe tener entre ${PASSWORD_NUEVA_MIN} y ${PASSWORD_MAX} caracteres`;
export const ERROR_PASSWORD_NUEVA_ESPACIOS = "La contraseña nueva no puede empezar ni terminar con espacios";
export const ERROR_PASSWORD_NUEVA_CELULAR = "La contraseña nueva no puede ser tu celular";
export const ERROR_PASSWORD_ACTUAL_FALTA = "Escribe tu contraseña actual";

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Hash y verificación.
// ---------------------------------------------------------------------------

function derivar(texto: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(texto, sal, HASH_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, clave) => {
      if (error) rechazar(error);
      else resolver(clave);
    });
  });
}

/** 'scrypt$<sal hex>$<hash hex>', con sal nueva cada vez: la misma contraseña
 *  nunca produce el mismo hash dos veces. */
export async function hashPassword(texto: string): Promise<string> {
  const sal = randomBytes(SAL_BYTES);
  const hash = await derivar(texto, sal);
  return `${ALGORITMO}$${sal.toString("hex")}$${hash.toString("hex")}`;
}

/** Sal y hash del formato guardado, o null si no es nuestro formato. */
function partesDe(guardado: string): { sal: Buffer; hash: Buffer } | null {
  const partes = guardado.split("$");
  if (partes.length !== 3 || partes[0] !== ALGORITMO) return null;
  const [, salHex, hashHex] = partes;
  if (!salHex || !hashHex || !HEX.test(salHex) || !HEX.test(hashHex)) return null;
  if (salHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return null;
  return { sal: Buffer.from(salHex, "hex"), hash: Buffer.from(hashHex, "hex") };
}

/**
 * ¿La contraseña tecleada produce el hash guardado? Comparación en tiempo
 * constante; timingSafeEqual exige buffers del mismo largo, así que un hash
 * guardado de otro largo (basura o formato viejo) se rechaza antes en vez de
 * tronar. Un hash que no es nuestro formato tampoco abre.
 */
export async function verificarPassword(texto: string, guardado: string): Promise<boolean> {
  const partes = partesDe(guardado);
  if (!partes) return false;
  const derivado = await derivar(texto, partes.sal);
  if (derivado.length !== partes.hash.length) return false;
  return timingSafeEqual(derivado, partes.hash);
}

// ---------------------------------------------------------------------------
// Validaciones de los bordes.
// ---------------------------------------------------------------------------

const CELULAR_NACIONAL = /^\d{10}$/;

function esObjeto(entrada: unknown): entrada is Record<string, unknown> {
  return typeof entrada === "object" && entrada !== null && !Array.isArray(entrada);
}

/** Una contraseña tecleada (la de entrar o la actual): texto de 1..64, tal cual. */
function leerPasswordTecleada(crudo: unknown): string | null {
  if (typeof crudo !== "string") return null;
  if (crudo.length === 0 || crudo.length > PASSWORD_MAX) return null;
  return crudo;
}

export interface CredencialesCliente {
  /** El celular nacional de 10 dígitos con el que entra. */
  usuario: string;
  password: string;
}

/**
 * `{ usuario, password }` del formulario de entrar. El usuario es el celular:
 * se normaliza como el resto del sistema (quita +52, 044, espacios y guiones)
 * y tiene que quedar en 10 dígitos, que es como está en el padrón. La
 * contraseña se toma TAL CUAL (sin recortar: si la guardó con espacios
 * adentro, así es), solo acotada a 64.
 */
export function validarCredenciales(entrada: unknown): Validacion<CredencialesCliente> {
  if (!esObjeto(entrada)) return { ok: false, error: ERROR_CREDENCIALES_CLIENTE };
  const usuario = normalizarTelefono(String(entrada.usuario ?? ""));
  const password = leerPasswordTecleada(entrada.password);
  if (!CELULAR_NACIONAL.test(usuario) || password === null) {
    return { ok: false, error: ERROR_CREDENCIALES_CLIENTE };
  }
  return { ok: true, datos: { usuario, password } };
}

/**
 * La contraseña nueva: 8..64 caracteres, sin espacios al inicio ni al final
 * (se pierden al teclear en el celular y después "no entra"), y distinta del
 * celular (con o sin formato), que es la contraseña por defecto.
 */
export function validarNuevaPassword(nueva: unknown, celular: string): Validacion<{ nueva: string }> {
  if (typeof nueva !== "string") return { ok: false, error: ERROR_PASSWORD_NUEVA_LARGO };
  if (nueva.length < PASSWORD_NUEVA_MIN || nueva.length > PASSWORD_MAX) {
    return { ok: false, error: ERROR_PASSWORD_NUEVA_LARGO };
  }
  if (nueva !== nueva.trim()) return { ok: false, error: ERROR_PASSWORD_NUEVA_ESPACIOS };
  if (nueva === celular || normalizarTelefono(nueva) === celular) {
    return { ok: false, error: ERROR_PASSWORD_NUEVA_CELULAR };
  }
  return { ok: true, datos: { nueva } };
}

export interface CambioPassword {
  actual: string;
  nueva: string;
}

/** `{ actual, nueva }` de POST /password: la actual tecleada y la nueva válida. */
export function validarCambioPassword(entrada: unknown, celular: string): Validacion<CambioPassword> {
  if (!esObjeto(entrada)) return { ok: false, error: ERROR_PASSWORD_ACTUAL_FALTA };
  const actual = leerPasswordTecleada(entrada.actual);
  if (actual === null) return { ok: false, error: ERROR_PASSWORD_ACTUAL_FALTA };
  const nueva = validarNuevaPassword(entrada.nueva, celular);
  if (!nueva.ok) return nueva;
  return { ok: true, datos: { actual, nueva: nueva.datos.nueva } };
}

// ---------------------------------------------------------------------------
// Lo que la página firma en la cookie del cliente.
// ---------------------------------------------------------------------------

export interface ClienteSesion {
  idCliente: number;
  nombre: string;
  /** El celular con el que entró (10 dígitos), no toda su lista. */
  telefono: string;
  /** Porcentaje del padrón, para que la pantalla lo diga. */
  descuento: number;
  /** Si el padrón le permite pedir desde fuera de la tienda. */
  permitirPedido: boolean;
  /** true = su contraseña sigue siendo el celular: la página le sugiere cambiarla. */
  passwordPorDefecto: boolean;
}

/** Lo justo para saludar, cotizar y saber si puede pedir. Sin RFC, correo,
 *  otros celulares, ligas al POS ni —por supuesto— nada del hash. */
export function clienteParaSesion(cliente: ClienteDescuento, telefono: string, passwordPorDefecto: boolean): ClienteSesion {
  return {
    idCliente: cliente.id,
    nombre: cliente.cliente,
    telefono,
    descuento: cliente.descuento,
    permitirPedido: cliente.permitirPedido,
    passwordPorDefecto,
  };
}
