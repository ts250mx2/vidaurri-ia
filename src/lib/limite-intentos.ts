// Límite de intentos en memoria (ventana deslizante). Sirve para frenar fuerza
// bruta en el login del mostrador; vive en el proceso, así que se reinicia con
// el servidor y no se comparte entre instancias — suficiente para un solo
// servidor interno, y por eso no se persiste en base.

export interface LimiteIntentos {
  maximo: number;
  ventanaMs: number;
}

export type RegistroIntentos = Map<string, number[]>;

/** Momentos de la ventana vigente para una clave (sin los ya vencidos). */
function vigentes(registro: RegistroIntentos, clave: string, ahora: number, ventanaMs: number): number[] {
  return (registro.get(clave) ?? []).filter((momento) => ahora - momento < ventanaMs);
}

/** ¿La clave ya agotó sus intentos dentro de la ventana? No registra nada. */
export function excedeLimite(
  registro: RegistroIntentos,
  clave: string,
  limite: LimiteIntentos,
  ahora = Date.now()
): boolean {
  return vigentes(registro, clave, ahora, limite.ventanaMs).length >= limite.maximo;
}

/** Anota un intento fallido en el registro. */
export function registrarIntento(
  registro: RegistroIntentos,
  clave: string,
  limite: LimiteIntentos,
  ahora = Date.now()
): void {
  registro.set(clave, [...vigentes(registro, clave, ahora, limite.ventanaMs), ahora]);
}

/** Olvida la clave (tras un login correcto, para no castigar al que ya entró). */
export function limpiarIntentos(registro: RegistroIntentos, clave: string): void {
  registro.delete(clave);
}

/**
 * Poda las claves sin intentos vigentes. Se llama de vez en cuando para que un
 * ataque con miles de usuarios/IPs distintas no deje el Map creciendo sin fin.
 */
export function podarIntentos(registro: RegistroIntentos, limite: LimiteIntentos, ahora = Date.now()): void {
  for (const clave of [...registro.keys()]) {
    if (vigentes(registro, clave, ahora, limite.ventanaMs).length === 0) registro.delete(clave);
  }
}

/** Un cubo del login: la clave que se cuenta y el tope que le aplica. */
export interface CuboIntentos {
  clave: string;
  limite: LimiteIntentos;
}

const VENTANA_LOGIN_MS = 10 * 60 * 1000;
/** Por cuenta: el freno real contra fuerza bruta sobre un usuario. */
export const LIMITE_POR_USUARIO: LimiteIntentos = { maximo: 5, ventanaMs: VENTANA_LOGIN_MS };
/** Por IP confiable (la que vidaurri-page ve detrás de un proxy declarado). */
export const LIMITE_POR_IP: LimiteIntentos = { maximo: 5, ventanaMs: VENTANA_LOGIN_MS };
/**
 * Cubo compartido cuando no hay IP confiable. Frena el rociado sobre muchas
 * cuentas sin que 5 errores de una persona bloqueen a todo el mostrador.
 */
export const LIMITE_SIN_IP: LimiteIntentos = { maximo: 50, ventanaMs: VENTANA_LOGIN_MS };
export const CLAVE_SIN_IP = "sin-ip";

/**
 * Cubos que cuentan un intento de login: siempre el de la cuenta (en
 * minúsculas: la colación del POS no distingue mayúsculas, así que "Juan" y
 * "juan" son la misma cuenta atacada) y, si hay IP confiable, el de esa IP;
 * si no, el cubo compartido con tope alto.
 */
export function cubosDeLogin(usuario: string, ip: string | null): CuboIntentos[] {
  const porUsuario = { clave: `u:${usuario.toLowerCase()}`, limite: LIMITE_POR_USUARIO };
  if (ip) return [porUsuario, { clave: `ip:${ip}`, limite: LIMITE_POR_IP }];
  return [porUsuario, { clave: CLAVE_SIN_IP, limite: LIMITE_SIN_IP }];
}

/** ¿Algún cubo ya agotó sus intentos? */
export function algunCuboExcede(registro: RegistroIntentos, cubos: CuboIntentos[], ahora = Date.now()): boolean {
  return cubos.some((cubo) => excedeLimite(registro, cubo.clave, cubo.limite, ahora));
}

/** Anota un intento fallido en todos los cubos. */
export function registrarEnCubos(registro: RegistroIntentos, cubos: CuboIntentos[], ahora = Date.now()): void {
  for (const cubo of cubos) registrarIntento(registro, cubo.clave, cubo.limite, ahora);
}
