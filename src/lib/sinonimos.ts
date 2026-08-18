// Sinónimos, abreviaturas y erratas para las búsquedas del catálogo.
//
// El catálogo está capturado con el vocabulario del mostrador y muy abreviado
// ("FASCIA DEL AVEO 18-23 DER"), pero el cliente escribe como habla: "facia",
// "capó", "bumper", "puerta delantera derecha". Sin esta capa esas búsquedas
// devuelven cero: en bdav sólo 1 artículo dice "DELANTER" y ninguno "DERECH".
//
// Los grupos son bidireccionales: da igual qué palabra del grupo escriba el
// cliente, se busca por todas. El vocabulario está tomado de los datos reales
// de bdav y de la Bodega Usado, no de suposiciones.

import { normalizarTexto, raizBusqueda } from "@/lib/texto";

// Cada arreglo agrupa términos equivalentes. Sólo palabras sueltas: la
// búsqueda parte la frase del cliente en palabras.
const GRUPOS: string[][] = [
  // Piezas: el catálogo escribe "FASCIA"; el cliente dice facia o bumper.
  ["fascia", "facia", "bumper", "defensa"],
  ["cofre", "capo", "capot", "capota"],
  ["calavera", "calabera", "stop", "mica"],
  ["faro", "farola", "foco"],
  ["salpicadera", "salpicdera", "guardafango", "guardabarros", "aleta"],
  ["espejo", "retrovisor"],
  ["parrilla", "parriya", "rejilla", "persiana"],
  ["cajuela", "maletero", "baul"],
  ["quinta", "porton", "compuerta"],
  ["puerta", "portezuela"],
  ["moldura", "embellecedor"],
  ["tolva", "guardapolvo"],
  ["motoventilador", "electroventilador", "ventilador", "abanico"],
  ["elevador", "regulador"],
  ["manija", "manivela", "jaladera"],
  ["bisagra", "visagra"],
  ["condensador", "condenzador"],
  ["radiador", "radeador"],
  ["polvera", "polbera"],
  ["cuarto", "direccional"],
  ["spoiler", "espoiler", "aleron"],
  ["lodera", "faldon"],
  ["birlo", "tornillo"],
];

// Posición del auto. Va aparte porque NO debe filtrar, solo ordenar: bdav
// abrevia (DEL / TRAS / DER / IZQ), la Bodega Usado escribe la palabra completa
// ("DELANTERO(A)") y muchas piezas ni siquiera la traen — la puerta de la
// Silverado 92-98 no dice si es delantera. Si "delantera" fuera obligatoria,
// esa puerta jamás aparecería. Se busca por todas las formas, pero como
// preferencia: primero las que coinciden con el lado que pidió el cliente.
const GRUPOS_POSICION: string[][] = [
  ["delantera", "delantero", "del", "frontal"],
  ["trasera", "trasero", "tras"],
  ["derecha", "derecho", "der"],
  ["izquierda", "izquierdo", "izq"],
];

// Índice: término normalizado -> todos los términos de su grupo.
const INDICE = new Map<string, string[]>();
for (const grupo of [...GRUPOS, ...GRUPOS_POSICION]) {
  for (const termino of grupo) {
    INDICE.set(normalizarTexto(termino), grupo);
  }
}

const POSICIONES = new Set(GRUPOS_POSICION.flat().map(normalizarTexto));

/** ¿La palabra indica el lado o el frente/atrás de la pieza? */
export function esPalabraDePosicion(palabra: string): boolean {
  return POSICIONES.has(normalizarTexto(palabra));
}

/**
 * Fragmentos a buscar para una palabra del cliente: la raíz de la palabra más
 * la de cada sinónimo, abreviatura o errata conocida. Se combinan con OR, de
 * modo que "facia" también encuentre FASCIA y "capó" encuentre COFRE.
 */
export function variantesBusqueda(palabra: string): string[] {
  const normal = normalizarTexto(palabra);
  if (!normal) return [];
  const grupo = INDICE.get(normal) ?? [normal];
  const variantes = new Set<string>();
  for (const termino of grupo) variantes.add(raizBusqueda(normalizarTexto(termino)));
  variantes.add(raizBusqueda(normal)); // la palabra tal cual, por si no hay grupo
  return [...variantes].filter((v) => v.length >= 2);
}
