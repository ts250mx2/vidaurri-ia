// De dónde viene la pieza nueva que se le ofrece al cliente.
//
// Lo que hay en la Matriz es existencia propia. Lo que NO hay aquí pero sí en
// Aldo Autopartes es refacción de importación taiwanesa, y eso el cliente tiene
// derecho a saberlo antes de comprar: no es lo mismo la pieza de la casa que
// una copia de importación. La regla vive aquí, y no repetida en cada pantalla,
// para que el Vendedor IA y el catálogo del panel no puedan decir cosas
// distintas de la misma pieza.

export const OBSERVACION_TAIWAN = "Taiwán";

/**
 * ¿Aldo tiene existencia? Su catálogo devuelve un número exacto o una etiqueta
 * tipo "Mas de 60", así que hay que aceptar las dos formas. `null` es "no se
 * consultó", que no es lo mismo que "no hay".
 */
export function hayExistenciaAldo(valor: number | string | null | undefined): boolean {
  if (valor == null) return false;
  if (typeof valor === "number") return valor > 0;
  const digitos = valor.match(/\d+/);
  return digitos ? Number(digitos[0]) > 0 : false;
}

/**
 * Observación de origen de un artículo nuevo: "Taiwán" cuando no hay existencia
 * propia y sí la hay con el proveedor. En cualquier otro caso, null (no hay
 * nada que observar): si hay existencia propia se entrega de la casa, y si no
 * la tiene nadie no hay pieza de la cual decir el origen.
 */
export function observacionOrigen(
  existenciaPropia: number | null | undefined,
  existenciaAldo: number | string | null | undefined
): string | null {
  const propia = Number(existenciaPropia ?? 0);
  if (propia > 0) return null;
  return hayExistenciaAldo(existenciaAldo) ? OBSERVACION_TAIWAN : null;
}
