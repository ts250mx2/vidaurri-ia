// Utilidades de texto para búsquedas.

/**
 * Raíz de una palabra para búsqueda con LIKE: quita la terminación de género/
 * número ("delantera" → "delanter", "usados" → "usad") para que cruce con
 * capturas como "DELANTERO(A)" o "DERECHO(A)" de la Bodega Usado. Si la raíz
 * queda muy corta se conserva la palabra original.
 */
export function raizBusqueda(palabra: string): string {
  const raiz = palabra.replace(/(os|as)$/i, "").replace(/[oa]$/i, "");
  return raiz.length >= 3 ? raiz : palabra;
}
