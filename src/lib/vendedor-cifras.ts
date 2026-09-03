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

/**
 * Lo que una herramienta devuelve en su JSON, en lo que toca al contraste.
 * Las búsquedas traen `resultados`; las tools de pedido (ver_pedido,
 * confirmar_pedido...) traen además el folio y los totales del pedido.
 */
interface DatosHerramienta {
  resultados?: FilaHerramienta[];
  /** Folios de pedido ("P-000131"). */
  folios?: unknown;
  /** Subtotal, IVA, total e importes por partida, ya con IVA. */
  importes?: unknown;
}

function agregarPrecio(valor: unknown, precios: Set<number>): void {
  const numero = Number(valor);
  if (Number.isFinite(numero) && numero > 0) precios.add(Math.round(numero * 100) / 100);
}

// Las tools construyen estos campos en el servidor, pero el contraste no debe
// tronar un turno entero si algún día llega algo que no es lista.
function comoLista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Apunta lo que devolvió una búsqueda para poder contrastar la respuesta. */
export function registrarResultado(contenido: string, catalogo: CatalogoTurno): void {
  let datos: DatosHerramienta;
  try {
    datos = JSON.parse(contenido) as DatosHerramienta;
  } catch {
    return; // resultado no parseable: no hay nada que registrar
  }
  if (!datos || typeof datos !== "object") return; // JSON válido pero sin forma de objeto
  for (const fila of datos.resultados ?? []) {
    if (typeof fila.codigo === "string" && fila.codigo) catalogo.codigos.add(fila.codigo.toUpperCase());
    if (typeof fila.descripcion === "string") catalogo.descripciones.push(fila.descripcion.toUpperCase());
    agregarPrecio(fila.precioConIva, catalogo.precios);
    agregarPrecio(fila.precioSinIva, catalogo.precios);
    agregarPrecio(fila.usado?.desdeConIva, catalogo.precios);
  }
  // El folio del pedido ("P-000131") mezcla letra y dígitos igual que un código
  // de artículo, y el total ("$5,858.00") se lee como un precio: si no se
  // apuntan aquí, el agente que los cita tal cual sale marcado como inventado.
  for (const folio of comoLista(datos.folios)) {
    if (typeof folio === "string" && folio) catalogo.codigos.add(folio.toUpperCase());
  }
  for (const importe of comoLista(datos.importes)) agregarPrecio(importe, catalogo.precios);
}

// Un código de artículo mezcla letras y dígitos ("DDDAI15", "GTCAE18R",
// "PTA-54-693-DDE10-R1-B38"). El doble lookahead exige ambas cosas, así que no
// confunde palabras en mayúsculas ("FASCIA") ni rangos de años ("18-23").
const POSIBLE_CODIGO = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{5,}\b/g;

// Importes escritos como precio: "$1,798.00", "$1798", "$ 1,550".
const IMPORTE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

/**
 * Da por buenos los códigos y precios que el agente ya dijo antes en la misma
 * conversación. El cliente pregunta "¿y la usada?" o "¿me lo repites?" y la
 * respuesta legítimamente repite cifras de un turno anterior, cuando la
 * búsqueda que las produjo ya no se vuelve a ejecutar. Sin esto se marcaban
 * como inventados precios que sí salieron del catálogo.
 */
export function registrarRespuestaPrevia(texto: string, catalogo: CatalogoTurno): void {
  const mayusculas = texto.toUpperCase();
  for (const [token] of mayusculas.matchAll(POSIBLE_CODIGO)) catalogo.codigos.add(token);
  for (const [, importe] of texto.matchAll(IMPORTE)) {
    agregarPrecio(Number(importe.replace(/,/g, "")), catalogo.precios);
  }
}

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
