import { consultaBdav } from "@/lib/db";

// Identifica al cliente que escribe por WhatsApp para cotizarle con SU
// descuento. Solo lectura: aquí no se da de alta a nadie.
//
// Los teléfonos del padrón están capturados a mano y sin formato fijo:
// "81-8383-46-46", "8114659427", "28114709989" y 4,313 fijos viejos de 8
// dígitos sin lada. Solo los de 10 dígitos pueden cruzarse con un número de
// WhatsApp (1,086 de 6,436 clientes); los de 8 se quedan fuera a propósito,
// porque casar por 8 dígitos inventaría coincidencias.

/** Cliente identificado por su teléfono. */
export interface ClienteWhatsapp {
  nombre: string;
  /** Porcentaje de descuento sobre el precio de lista (0-100). */
  descuento: number;
}

/**
 * Número nacional de 10 dígitos, o null si no se puede afirmar que sea
 * mexicano. WhatsApp manda el número con lada de país y a veces con el "1" de
 * México (5218112345678); también llegan 528112345678 y, en pruebas, los 10
 * dígitos pelones. Cualquier otra lada se descarta en vez de adivinar: los
 * últimos 10 dígitos de un número extranjero pueden coincidir con los de un
 * cliente de aquí y le daríamos su precio a un desconocido.
 */
export function telefonoMexicanoA10(telefono: string): string | null {
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  if (digitos.length === 10) return digitos;
  if (digitos.length === 12 && digitos.startsWith("52")) return digitos.slice(-10);
  if (digitos.length === 13 && digitos.startsWith("521")) return digitos.slice(-10);
  return null;
}

// MySQL 5.7 no tiene REGEXP_REPLACE, así que los separadores se quitan a mano.
// RIGHT() sobre un texto más corto devuelve el texto entero, de modo que un
// fijo de 8 dígitos nunca iguala a una clave de 10: no hace falta filtrar largo.
const TELEFONO_LIMPIO =
  "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(telefono,'-',''),' ',''),'(',''),')',''),'+',''),'.',''), 10)";

/**
 * Cliente al que pertenece ese teléfono, o null si no está en el padrón, si el
 * número no es mexicano, o si el mismo teléfono aparece en varios clientes con
 * descuentos distintos. Ese último caso —2 de 1,086 teléfonos— se resuelve NO
 * personalizando: ante la duda, precio de mostrador, que es preferible a
 * regalarle a alguien el descuento de otro.
 */
export async function clientePorTelefono(telefono: string): Promise<ClienteWhatsapp | null> {
  const clave = telefonoMexicanoA10(telefono);
  if (!clave) return null;

  const filas = await consultaBdav<{ nombre: string; descuento: number }>(
    `SELECT IFNULL(nombre, '') AS nombre, IFNULL(descuento, 0) AS descuento
       FROM clientes
      WHERE ${TELEFONO_LIMPIO} = ?
      LIMIT 20`,
    [clave]
  );
  if (filas.length === 0) return null;

  const descuentos = new Set(filas.map((f) => Number(f.descuento)));
  if (descuentos.size > 1) {
    console.warn(
      `[cliente-whatsapp] ${clave} aparece en ${filas.length} clientes con descuentos distintos (${[...descuentos].join(", ")}): se cotiza a precio de mostrador`
    );
    return null;
  }

  const descuento = Number(filas[0].descuento);
  if (!Number.isFinite(descuento) || descuento < 0 || descuento >= 100) return null;
  return { nombre: filas[0].nombre, descuento };
}
