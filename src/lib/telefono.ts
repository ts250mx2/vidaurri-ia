// Teléfonos: normalización compartida entre la captura de clientes con
// descuento, la búsqueda en el catálogo de bdav y lo que llega de WhatsApp.
//
// WhatsApp manda el número con lada de país y el "1" viejo de móvil
// (5218112345678 o +52 81 1234 5678); en mostrador se captura de 10 dígitos
// con o sin espacios/guiones, a veces con 044/045/01 por delante; bdav guarda
// de todo ('83 74 95 95', '14-77-74-64'). La forma canónica del sistema es el
// número NACIONAL de 10 dígitos; lo que no sea de México se deja como venga.

export const TELEFONO_MAX = 20;
const DIGITOS_NACIONAL = 10;

/** Prefijos que se quitan cuando lo que sigue es un número nacional completo. */
const PREFIJOS_MEXICO = ["521", "52", "045", "044", "01"];

export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * '+52 81 1234 5678', '5218112345678', '044 81 1234 5678' → '8112345678'.
 * Un número sin prefijo, o de otro país, queda solo en dígitos (máx. 20).
 */
export function normalizarTelefono(entrada: string): string {
  const digitos = soloDigitos(entrada);
  const prefijo = PREFIJOS_MEXICO.find(
    (p) => digitos.length === DIGITOS_NACIONAL + p.length && digitos.startsWith(p)
  );
  const nacional = prefijo ? digitos.slice(prefijo.length) : digitos;
  return nacional.slice(0, TELEFONO_MAX);
}

/** Apto para dar de alta: 10 dígitos (México) o hasta 15 (E.164, otro país). */
export function esTelefonoValido(telefonoNormalizado: string): boolean {
  return /^\d{10,15}$/.test(telefonoNormalizado);
}
