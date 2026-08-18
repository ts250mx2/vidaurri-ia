// Construcción de las condiciones LIKE que comparten el Vendedor IA y las
// páginas del catálogo, para que el chat y el sitio encuentren lo mismo.

import { esPalabraDePosicion, variantesBusqueda } from "@/lib/sinonimos";

// Tope de palabras de la frase del cliente: cada una se expande a sus
// sinónimos por varios campos, así que sin tope la consulta crece de más.
export const MAX_PALABRAS_BUSQUEDA = 6;

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
 * "DER" si el cliente pidió la derecha. Devuelve "0" si no hay nada que medir.
 * Empuja sus parámetros a `params`, en el mismo orden en que salen en el SQL.
 */
export function expresionRelevancia(
  variantesPorPalabra: string[][],
  campos: readonly string[],
  params: unknown[]
): string {
  const terminos: string[] = [];
  for (const variantes of variantesPorPalabra) {
    const alternativas: string[] = [];
    for (const variante of variantes) {
      for (const campo of campos) {
        alternativas.push(`${campo} LIKE ?`);
        params.push(`%${variante}%`);
      }
    }
    terminos.push(`(CASE WHEN ${alternativas.join(" OR ")} THEN 1 ELSE 0 END)`);
  }
  return terminos.length > 0 ? terminos.join(" + ") : "0";
}
