// Construcción de las condiciones LIKE que comparten el Vendedor IA y las
// páginas del catálogo, para que el chat y el sitio encuentren lo mismo.

import { esPalabraDePosicion, variantesBusqueda } from "@/lib/sinonimos";

// Tope de palabras de la frase del cliente: cada una se expande a sus
// sinónimos por varios campos, así que sin tope la consulta crece de más.
export const MAX_PALABRAS_BUSQUEDA = 6;

/**
 * Cómo debe cruzar la palabra para sumar relevancia. "empieza" aprovecha que
 * la descripción arranca siempre por la pieza ("FASCIA DEL AVEO 18-23"), de
 * modo que distingue la pieza real de sus accesorios ("GUIA FASCIA DEL AVEO").
 */
export type PatronRelevancia = "contiene" | "empieza";

export interface PalabrasBusqueda {
  /** Variantes de las palabras que la pieza SÍ debe traer (pieza, modelo...). */
  requeridas: string[][];
  /** Variantes de posición: no filtran, solo mandan al frente lo que coincide. */
  opcionales: string[][];
}

/**
 * Convierte las palabras del cliente en condiciones LIKE: cada palabra debe
 * aparecer en alguno de los `campos`, contando sus sinónimos y abreviaturas
 * ("facia" → FASCIA, "capó" → COFRE). Empuja las condiciones y sus parámetros
 * a los arreglos recibidos.
 *
 * Las palabras de posición ("delantera", "derecha") se apartan en `opcionales`
 * y NO se exigen: el catálogo muchas veces no captura el lado, y exigirlo
 * escondía piezas que sí existen. Se usan para ordenar con
 * `expresionRelevancia`.
 */
export function condicionesPorPalabra(
  frase: string,
  campos: readonly string[],
  condiciones: string[],
  params: unknown[]
): PalabrasBusqueda {
  const palabras = frase.split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS_BUSQUEDA);
  const requeridas: string[][] = [];
  const opcionales: string[][] = [];
  for (const palabra of palabras) {
    const variantes = variantesBusqueda(palabra);
    if (variantes.length === 0) continue;
    if (esPalabraDePosicion(palabra)) {
      opcionales.push(variantes);
      continue;
    }
    const alternativas: string[] = [];
    for (const variante of variantes) {
      for (const campo of campos) {
        alternativas.push(`${campo} LIKE ?`);
        params.push(`%${variante}%`);
      }
    }
    condiciones.push(`(${alternativas.join(" OR ")})`);
    requeridas.push(variantes);
  }
  return { requeridas, opcionales };
}

/**
 * Expresión SQL que cuenta cuántas de esas palabras coincide cada fila, para
 * usarla en el ORDER BY: entre dos puertas de Silverado, primero la que dice
 * "DER" si el cliente pidió la derecha. Empuja sus parámetros a `params`, en el
 * mismo orden en que salen en el SQL.
 *
 * Sin nada que medir devuelve `NULL`, no `0`: MySQL lee un número suelto en el
 * ORDER BY como posición de columna y `ORDER BY 0` es un error.
 */
export function expresionRelevancia(
  variantesPorPalabra: string[][],
  campos: readonly string[],
  params: unknown[],
  patron: PatronRelevancia = "contiene"
): string {
  const terminos: string[] = [];
  for (const variantes of variantesPorPalabra) {
    const alternativas: string[] = [];
    for (const variante of variantes) {
      for (const campo of campos) {
        alternativas.push(`${campo} LIKE ?`);
        params.push(patron === "empieza" ? `${variante}%` : `%${variante}%`);
      }
    }
    terminos.push(`(CASE WHEN ${alternativas.join(" OR ")} THEN 1 ELSE 0 END)`);
  }
  return terminos.length > 0 ? terminos.join(" + ") : "NULL";
}
