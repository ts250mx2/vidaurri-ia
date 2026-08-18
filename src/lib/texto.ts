// Utilidades de texto para búsquedas.

// Largo mínimo de la raíz. Con menos, el recorte deja fragmentos que casan con
// cualquier cosa: "capo" quedaba en "cap" y traía las 751 piezas de CAPTIVA,
// y "faro" quedaba en "far". Con 4 se siguen cubriendo los casos que importan
// ("usados"→"usad", "delantera"→"delanter", "derecha"→"derech").
const LARGO_MINIMO_RAIZ = 4;

/**
 * Raíz de una palabra para búsqueda con LIKE: quita la terminación de género/
 * número ("delantera" → "delanter", "usados" → "usad") para que cruce con
 * capturas como "DELANTERO(A)" o "DERECHO(A)" de la Bodega Usado. Si la raíz
 * queda muy corta se conserva la palabra original.
 */
export function raizBusqueda(palabra: string): string {
  const raiz = palabra.replace(/(os|as)$/i, "").replace(/[oa]$/i, "");
  return raiz.length >= LARGO_MINIMO_RAIZ ? raiz : palabra;
}

/**
 * Minúsculas y sin acentos, para comparar sin importar cómo se escriba el
 * cliente ("capó" y "capo" son la misma palabra al buscar).
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
