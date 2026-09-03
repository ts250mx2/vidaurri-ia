// Productos que Vico consultó en un turno del mostrador, listos para que la
// pantalla de vidaurri-page pinte un botón "Agregar al pedido" por renglón.
// Lógica PURA: recibe los resultados crudos que devolvieron las herramientas
// de búsqueda en ESE turno (con el precio que Vico ya vio, es decir con el
// descuento del cliente atendido) y no vuelve a consultar nada. El vendedor
// agrega desde aquí con el código o el idPieza exacto, sin transcribirlo.

/** Tope de renglones por respuesta: más de esto la pantalla se vuelve lista. */
export const MAX_PRODUCTOS_MENCIONADOS = 8;

export interface ProductoMencionado {
  origen: "nueva" | "usada";
  codigo: string;
  /** Referencia de la pieza usada (el código de la Bodega no es único); null en nuevas. */
  idPiezaUsada: number | null;
  descripcion: string;
  precioConIva: number;
  existencia: number;
  /** URL de la foto sellada cuando la respuesta la trae; null si no. */
  foto: string | null;
}

export interface EntradaProductosMencionados {
  /** Resultados de cada búsqueda del turno, en el orden en que corrieron. */
  resultadosPorHerramienta: Array<{ herramienta: string; resultados: unknown[] }>;
  /** Respuesta final de Vico (con o sin la línea [[FOTOS: ...]]). */
  texto: string;
  /** Fotos ya resueltas para esta respuesta (código → URL del proxy). */
  fotos: Array<{ codigo: string; url: string }>;
}

const HERRAMIENTA_NUEVAS = "buscar_productos";
const HERRAMIENTA_USADAS = "buscar_piezas_usadas";

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoNoVacio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : null;
}

function numeroFinito(valor: unknown): number | null {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Existencia de una fila: el primer campo numérico de la lista, o 0. */
function existenciaDe(fila: Record<string, unknown>, campos: string[]): number {
  for (const campo of campos) {
    const n = numeroFinito(fila[campo]);
    if (n !== null) return Math.max(0, n);
  }
  return 0;
}

/** Fila de buscar_productos → renglón; null si le falta lo indispensable. */
function nuevaDe(fila: unknown): ProductoMencionado | null {
  if (!esObjeto(fila)) return null;
  const codigo = textoNoVacio(fila.codigo);
  const descripcion = textoNoVacio(fila.descripcion);
  const precioConIva = numeroFinito(fila.precioConIva);
  if (!codigo || !descripcion || precioConIva === null) return null;
  return {
    origen: "nueva",
    codigo,
    idPiezaUsada: null,
    descripcion,
    precioConIva,
    // La herramienta expone la existencia en tienda como entregaInmediata;
    // `existencia` se acepta por si algún día cambia el nombre.
    existencia: existenciaDe(fila, ["entregaInmediata", "existencia"]),
    foto: null,
  };
}

/** Fila de buscar_piezas_usadas → renglón; sin idPieza no se puede pedir, así que se omite. */
function usadaDe(fila: unknown): ProductoMencionado | null {
  if (!esObjeto(fila)) return null;
  const codigo = textoNoVacio(fila.codigo);
  const descripcion = textoNoVacio(fila.descripcion);
  const precioConIva = numeroFinito(fila.precioConIva);
  const idPieza = numeroFinito(fila.idPieza);
  if (!codigo || !descripcion || precioConIva === null) return null;
  if (idPieza === null || !Number.isSafeInteger(idPieza) || idPieza <= 0) return null;
  return {
    origen: "usada",
    codigo,
    idPiezaUsada: idPieza,
    descripcion,
    precioConIva,
    existencia: existenciaDe(fila, ["existencia"]),
    foto: null,
  };
}

/** Identidad del renglón para no repetir la misma pieza si Vico buscó dos veces. */
function llaveDe(p: ProductoMencionado): string {
  return p.origen === "usada" ? `usada:${p.idPiezaUsada}` : `nueva:${p.codigo.toUpperCase()}`;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ¿El código aparece en la respuesta como palabra completa? Se exige frontera
 * alfanumérica porque hay códigos de la Bodega de dos o tres letras que como
 * subcadena casarían con cualquier frase.
 */
export function codigoMencionado(texto: string, codigo: string): boolean {
  const patron = new RegExp(`(^|[^A-Z0-9])${escaparRegex(codigo.toUpperCase())}(?![A-Z0-9])`);
  return patron.test(texto.toUpperCase());
}

/**
 * Renglones para la pantalla: primero las piezas que Vico mencionó en su
 * respuesta (en el orden en que las consultó), luego el resto de lo que
 * devolvieron las búsquedas, recortado a MAX_PRODUCTOS_MENCIONADOS. Sin
 * búsquedas en el turno devuelve [] y la pantalla no pinta nada.
 */
export function productosMencionados(entrada: EntradaProductosMencionados): ProductoMencionado[] {
  const fotoPorCodigo = new Map(entrada.fotos.map((f) => [f.codigo.toUpperCase(), f.url] as const));
  const vistos = new Set<string>();
  const consultados: ProductoMencionado[] = [];

  for (const { herramienta, resultados } of entrada.resultadosPorHerramienta) {
    const convertir =
      herramienta === HERRAMIENTA_NUEVAS ? nuevaDe : herramienta === HERRAMIENTA_USADAS ? usadaDe : null;
    if (!convertir || !Array.isArray(resultados)) continue;
    for (const fila of resultados) {
      const producto = convertir(fila);
      if (!producto) continue;
      const llave = llaveDe(producto);
      if (vistos.has(llave)) continue;
      vistos.add(llave);
      consultados.push({ ...producto, foto: fotoPorCodigo.get(producto.codigo.toUpperCase()) ?? null });
    }
  }

  const mencionados = consultados.filter((p) => codigoMencionado(entrada.texto, p.codigo));
  const resto = consultados.filter((p) => !codigoMencionado(entrada.texto, p.codigo));
  return [...mencionados, ...resto].slice(0, MAX_PRODUCTOS_MENCIONADOS);
}
