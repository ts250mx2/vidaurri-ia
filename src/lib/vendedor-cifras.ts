// Verificación de que el Vendedor IA sólo diga códigos y precios que salieron
// del catálogo.
//
// El modelo llegó a contestar el código "DDDAI145" (no existe; el real es
// DDDAI15) y un precio de $104.08 que no corresponde a ningún artículo: los
// escribió de memoria en vez de copiarlos del resultado de la búsqueda. Como el
// agente cotiza dinero real a clientes, la respuesta se revisa contra lo que
// devolvieron las herramientas de ese turno antes de mandarla.

/** Códigos, descripciones y precios que las herramientas devolvieron. */
export interface CatalogoTurno {
  codigos: Set<string>;
  descripciones: string[];
  precios: Set<number>;
}

export function catalogoVacio(): CatalogoTurno {
  return { codigos: new Set(), descripciones: [], precios: new Set() };
}

interface FilaHerramienta {
  codigo?: unknown;
  descripcion?: unknown;
  precioConIva?: unknown;
  precioSinIva?: unknown;
  usado?: { desdeConIva?: unknown } | null;
}

function agregarPrecio(valor: unknown, precios: Set<number>): void {
  const numero = Number(valor);
  if (Number.isFinite(numero) && numero > 0) precios.add(Math.round(numero * 100) / 100);
}

/** Apunta lo que devolvió una búsqueda para poder contrastar la respuesta. */
export function registrarResultado(contenido: string, catalogo: CatalogoTurno): void {
  let datos: { resultados?: FilaHerramienta[] };
  try {
    datos = JSON.parse(contenido) as { resultados?: FilaHerramienta[] };
  } catch {
    return; // resultado no parseable: no hay nada que registrar
  }
  for (const fila of datos.resultados ?? []) {
    if (typeof fila.codigo === "string" && fila.codigo) catalogo.codigos.add(fila.codigo.toUpperCase());
    if (typeof fila.descripcion === "string") catalogo.descripciones.push(fila.descripcion.toUpperCase());
    agregarPrecio(fila.precioConIva, catalogo.precios);
    agregarPrecio(fila.precioSinIva, catalogo.precios);
    agregarPrecio(fila.usado?.desdeConIva, catalogo.precios);
  }
}

// Un código de artículo mezcla letras y dígitos ("DDDAI15", "GTCAE18R",
// "PTA-54-693-DDE10-R1-B38"). El doble lookahead exige ambas cosas, así que no
// confunde palabras en mayúsculas ("FASCIA") ni rangos de años ("18-23").
const POSIBLE_CODIGO = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{5,}\b/g;

// Importes escritos como precio: "$1,798.00", "$1798", "$ 1,550".
const IMPORTE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

export interface CifrasInventadas {
  codigos: string[];
  precios: string[];
}

/**
 * Códigos y precios de la respuesta que no aparecen en el catálogo del turno.
 * Un código se da por bueno si vino en los resultados o si forma parte de
 * alguna descripción (las descripciones traen claves del proveedor como
 * "ALD265", y el agente a veces las copia tal cual).
 */
export function cifrasInventadas(texto: string, catalogo: CatalogoTurno): CifrasInventadas {
  const codigos: string[] = [];
  const precios: string[] = [];
  if (catalogo.codigos.size === 0 && catalogo.precios.size === 0) {
    return { codigos, precios }; // sin búsquedas en el turno, nada que contrastar
  }

  const mayusculas = texto.toUpperCase();
  for (const [token] of mayusculas.matchAll(POSIBLE_CODIGO)) {
    if (catalogo.codigos.has(token)) continue;
    if (catalogo.descripciones.some((d) => d.includes(token))) continue;
    if (!codigos.includes(token)) codigos.push(token);
  }

  for (const [, importe] of texto.matchAll(IMPORTE)) {
    const numero = Math.round(Number(importe.replace(/,/g, "")) * 100) / 100;
    if (!Number.isFinite(numero) || catalogo.precios.has(numero)) continue;
    const texto_ = `$${importe}`;
    if (!precios.includes(texto_)) precios.push(texto_);
  }

  return { codigos, precios };
}
