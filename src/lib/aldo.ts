// Consulta el precio público de un artículo en el catálogo en línea de Aldo
// Autopartes (pi_resultados.jsp), parseando el HTML de resultados. Se cachea en
// memoria por código y se limita la concurrencia real contra su sitio para no
// saturarlo cuando la tabla del catálogo pide muchos códigos a la vez.
//
// Columnas de la tabla de Aldo (18-sep-2026): Código · Foto · Descripción ·
// Precio s/IVA · Precio c/IVA · Existencia · <día del siguiente reparto> ·
// Cantidad. La penúltima se llama "Viernes" o "Martes" según toque, así que se
// lee por POSICIÓN (el valor que sigue a la existencia), nunca por su nombre.
// Una pieza con Existencia 0 y reparto "Mas de 60" sí se consigue: es justo lo
// que aquí se vende "sobre pedido". Hasta esa fecha solo se leía Existencia y
// esas piezas salían como "no se consigue".
//
// Cortacircuito: si el sitio de Aldo deja de contestar, no se le sigue
// esperando en cada búsqueda. Tras FALLOS_PARA_ABRIR fallos de red seguidos se
// deja de consultarlo PAUSA_CIRCUITO_MS y precioAldo contesta al instante
// `sinRespuesta`; al vencer la pausa pasa UNA consulta de prueba. Sin esto, con
// Aldo mudo cada búsqueda de Vico esperaba el timeout por código y un turno de
// WhatsApp tardaba ~57 s (18-sep-2026), al filo del corte de nginx a los 60.

const URL_BUSQUEDA = "http://www.aldoautopartes.com/pi_resultados.jsp";
/** Variables de entorno que Aldo lee (inyectables en pruebas). */
export type EntornoAldo = Record<string, string | undefined>;

/**
 * A dónde se manda cada consulta. Si Aldo bloquea la IP del servidor, salen por
 * un proxy propio en otra máquina (scripts/aldo-proxy.mjs de vidaurri-ia, p. ej.
 * por Tailscale): ALDO_PROXY_URL es su base y ALDO_PROXY_KEY la llave compartida.
 */
export function destinoAldo(env: EntornoAldo = process.env): { url: string; headers: Record<string, string> } {
  const proxy = (env.ALDO_PROXY_URL ?? "").trim().replace(/\/+$/, "");
  if (!proxy) return { url: URL_BUSQUEDA, headers: {} };
  const llave = (env.ALDO_PROXY_KEY ?? "").trim();
  return { url: `${proxy}/pi_resultados.jsp`, headers: llave ? { "X-Aldo-Proxy-Key": llave } : {} };
}

/** La petición POST al buscador de Aldo (o al proxy), lista para fetch. */
function peticionAldo(termino: string, timeoutMs: number, env?: EntornoAldo): [string, RequestInit] {
  const destino = destinoAldo(env);
  return [
    destino.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        ...destino.headers,
      },
      body: "codigo=" + encodeURIComponent(termino),
      signal: AbortSignal.timeout(timeoutMs),
    },
  ];
}
/** La vista de Existencias del dashboard: el usuario pidió esa búsqueda y la espera. */
const TIMEOUT_BUSQUEDA_MS = 15000;
/** El precio por código que consulta Vico a media conversación: Aldo contesta
 *  en menos de 1 s cuando contesta; esperar más es dejar colgado al cliente. */
const TIMEOUT_PRECIO_MS = 5000;
const TTL_ENCONTRADO_MS = 30 * 60 * 1000; // 30 min si trajo precio
const TTL_NO_ENCONTRADO_MS = 5 * 60 * 1000; // 5 min si no estaba (permite reintento)
const MAX_CONCURRENTE = 4; // peticiones simultáneas máximas al sitio de Aldo
const FALLOS_PARA_ABRIR = 2;
const PAUSA_CIRCUITO_MS = 2 * 60 * 1000;

// URL pública de la foto del artículo en el catálogo de Aldo (Amazon S3).
const BASE_FOTOS_S3 = "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos";

/** URL pública (AWS S3) de la foto de un código. thumb=true para la miniatura. */
export function urlFotoAldo(codigo: string, thumb = false): string {
  const cod = encodeURIComponent(codigo.trim());
  return thumb ? `${BASE_FOTOS_S3}/_thumbs/${cod}.jpg` : `${BASE_FOTOS_S3}/${cod}.jpg`;
}

/** true si la foto existe en S3 (HEAD) — evita enviar enlaces rotos por WhatsApp. */
export async function fotoAldoExiste(codigo: string): Promise<boolean> {
  try {
    const res = await fetch(urlFotoAldo(codigo), {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Entidades HTML que aparecen en las descripciones (el sitio es ISO-8859-1).
const ENTIDADES: Record<string, string> = {
  "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú",
  "&Aacute;": "Á", "&Eacute;": "É", "&Iacute;": "Í", "&Oacute;": "Ó", "&Uacute;": "Ú",
  "&ntilde;": "ñ", "&Ntilde;": "Ñ", "&nbsp;": " ", "&amp;": "&",
};

/** Cantidad como la publica Aldo: número exacto o una etiqueta como "Mas de 60". */
export type CantidadAldo = number | string;

export interface PrecioAldo {
  encontrado: boolean;
  /**
   * true cuando NO se pudo preguntar (falla de red, timeout o cortacircuito
   * abierto). No es lo mismo que "Aldo no la tiene": quien decide con este dato
   * tiene que tratarlo como desconocido, no como cero.
   */
  sinRespuesta?: true;
  descripcion?: string;
  /** Precio de lista de Aldo sin IVA. */
  sinIva?: number;
  /** Precio de lista de Aldo con IVA. */
  conIva?: number;
  /** Lo que Aldo tiene hoy en anaquel (columna "Existencia"). */
  existencia?: CantidadAldo;
  /** Lo que Aldo entrega en su siguiente reparto (columna "Viernes"/"Martes"); ausente si la tabla no la trae. */
  proximoReparto?: CantidadAldo;
  /**
   * Lo que se puede conseguir con Aldo: la existencia si la hay y, si no, lo
   * del siguiente reparto. Es el dato para "sobre pedido".
   */
  disponible?: CantidadAldo;
}

/** Lo que se inyecta en pruebas: la red y el reloj. */
export interface DependenciasAldo {
  fetch?: typeof fetch;
  ahora?: () => number;
  env?: EntornoAldo;
}

const SIN_RESPUESTA: PrecioAldo = { encontrado: false, sinRespuesta: true };

const cache = new Map<string, { valor: PrecioAldo; expira: number }>();

// --- Semáforo de concurrencia hacia el sitio de Aldo ---
let activos = 0;
const cola: Array<() => void> = [];

async function conLimite<T>(fn: () => Promise<T>): Promise<T> {
  if (activos >= MAX_CONCURRENTE) {
    await new Promise<void>((resolver) => cola.push(resolver));
  }
  activos++;
  try {
    return await fn();
  } finally {
    activos--;
    cola.shift()?.();
  }
}

// --- Cortacircuito ---
let fallosSeguidos = 0;
let abiertoHasta = 0;
/** Ya hay una consulta de prueba en vuelo tras vencer la pausa. */
let probando = false;

type PasoCircuito = "pasa" | "prueba" | "cortado";

function pedirPaso(ahora: number): PasoCircuito {
  if (abiertoHasta === 0) return "pasa";
  if (ahora < abiertoHasta || probando) return "cortado";
  probando = true;
  return "prueba";
}

function anotarExito(): void {
  if (abiertoHasta !== 0) console.warn("[aldo] el sitio de Aldo volvió a contestar; se reanudan las consultas");
  fallosSeguidos = 0;
  abiertoHasta = 0;
  probando = false;
}

function anotarFallo(ahora: number): void {
  fallosSeguidos++;
  probando = false;
  if (fallosSeguidos < FALLOS_PARA_ABRIR) return;
  if (abiertoHasta <= ahora) {
    console.warn(
      `[aldo] el sitio de Aldo no contesta (${fallosSeguidos} fallos seguidos); sin consultarlo ${PAUSA_CIRCUITO_MS / 1000} s`
    );
  }
  abiertoHasta = ahora + PAUSA_CIRCUITO_MS;
}

/** Olvida el cache y el estado del cortacircuito (para las pruebas). */
export function reiniciarAldo(): void {
  cache.clear();
  cacheBusqueda.clear();
  fallosSeguidos = 0;
  abiertoHasta = 0;
  probando = false;
}

function textoPlano(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z]+;/g, (m) => ENTIDADES[m] ?? " ")
    .replace(/\s+/g, " ");
}

// Una cantidad de Aldo tiene forma de "Mas de N", "N.NN" o un entero corto. El
// tope de 4 dígitos importa: tras el reparto viene el código de la fila
// siguiente, y hay códigos puramente numéricos (22602650) que no son cantidad.
const CANTIDAD = String.raw`Mas de \d+|\d+\.\d{2}|\d{1,4}`;
/** El valor que sigue a la existencia, si tiene forma de cantidad: el siguiente reparto. */
const REPARTO_OPCIONAL = String.raw`(?:\s+(${CANTIDAD})(?=\s|$))?`;

function aCantidad(bruta: string): CantidadAldo {
  return /Mas de/i.test(bruta) ? bruta : parseFloat(bruta.replace(/,/g, ""));
}

function hayAlgo(cantidad: CantidadAldo | undefined): boolean {
  if (cantidad === undefined) return false;
  if (typeof cantidad === "number") return cantidad > 0;
  const digitos = cantidad.match(/\d+/);
  return digitos ? Number(digitos[0]) > 0 : false;
}

/** La existencia si la hay; si no, lo del siguiente reparto; si tampoco, 0. */
export function disponibleAldo(existencia: CantidadAldo | undefined, proximoReparto?: CantidadAldo): CantidadAldo {
  if (hayAlgo(existencia)) return existencia as CantidadAldo;
  if (hayAlgo(proximoReparto)) return proximoReparto as CantidadAldo;
  return 0;
}

const RE_PRECIO = new RegExp(
  String.raw`^\s+(.+?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(Mas de \d+|[\d.]+)` + REPARTO_OPCIONAL,
  "i"
);

function parsear(html: string, codigo: string): PrecioAldo {
  const t = textoPlano(html);
  const objetivo = codigo.trim().toUpperCase();
  const pos = t.toUpperCase().indexOf(objetivo);
  if (pos < 0) return { encontrado: false };

  // Tras el código: descripción, $ sin IVA, $ con IVA, existencia y siguiente reparto.
  const m = t.slice(pos + objetivo.length).match(RE_PRECIO);
  if (!m) return { encontrado: false };

  const num = (s: string) => parseFloat(s.replace(/,/g, ""));
  const existencia = aCantidad(m[4]);
  const proximoReparto = m[5] === undefined ? undefined : aCantidad(m[5]);
  return {
    encontrado: true,
    descripcion: m[1].trim(),
    sinIva: num(m[2]),
    conIva: num(m[3]),
    existencia,
    ...(proximoReparto === undefined ? {} : { proximoReparto }),
    disponible: disponibleAldo(existencia, proximoReparto),
  };
}

/** Sube si la red falla o vence el timeout; un HTTP de error del sitio es "no encontrado". */
async function consultarSitio(codigo: string, pedir: typeof fetch, env?: EntornoAldo): Promise<PrecioAldo> {
  const res = await pedir(...peticionAldo(codigo, TIMEOUT_PRECIO_MS, env));
  if (!res.ok) return { encontrado: false };
  // El sitio responde en ISO-8859-1: se decodifica el buffer como latin1.
  const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
  return parsear(html, codigo);
}

// ---------------------------------------------------------------------------
// Búsqueda multi-fila: el buscador de Aldo devuelve una tabla de resultados
// (puede traer varios códigos para un prefijo de código; NO busca por
// descripción). Se usa en la vista de Existencias con fuente "Aldo Autopartes".
// ---------------------------------------------------------------------------

export interface ResultadoAldo {
  codigo: string;
  descripcion: string;
  /** Precio de lista de Aldo sin IVA. */
  sinIva: number;
  /** Precio de lista de Aldo con IVA. */
  conIva: number;
  /** Lo que Aldo tiene hoy en anaquel: número exacto o etiqueta como "Mas de 60". */
  existencia: CantidadAldo;
  /** Lo que entrega en su siguiente reparto; ausente si la tabla no lo trae. */
  proximoReparto?: CantidadAldo;
}

const MAX_FILAS_BUSQUEDA = 50;
const cacheBusqueda = new Map<string, { valor: ResultadoAldo[]; expira: number }>();

/** Extrae todas las filas de resultados del HTML aplanado. Tras el encabezado
 *  (que termina en "Cantidad") vienen la categoría y las filas:
 *  CÓDIGO DESCRIPCIÓN [***** FNx.xx] $sinIVA $conIVA existencia reparto cantidad. */
function parsearFilas(html: string): ResultadoAldo[] {
  const t = textoPlano(html);
  // Recorta el encabezado de la tabla para no confundir sus palabras con datos.
  const inicio = t.search(/\bCantidad\b/);
  const cuerpo = inicio >= 0 ? t.slice(inicio + "Cantidad".length) : t;

  const filas: ResultadoAldo[] = [];
  // El código es todo mayúsculas/dígitos; la categoría ("Cofres") no matchea.
  const re = new RegExp(
    String.raw`([A-Z0-9][A-Z0-9._/-]{2,29})\s+(.{3,150}?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(Mas de \d+|\d+(?:\.\d+)?)(?=\s|$)` +
      REPARTO_OPCIONAL,
    "g"
  );
  const num = (s: string) => parseFloat(s.replace(/,/g, ""));
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo)) !== null && filas.length < MAX_FILAS_BUSQUEDA) {
    filas.push({
      codigo: m[1],
      // Quita la calificación/ubicación al final ("***** FN8.04").
      descripcion: m[2].replace(/\s*\*{2,}.*$/, "").trim(),
      sinIva: num(m[3]),
      conIva: num(m[4]),
      existencia: aCantidad(m[5]),
      ...(m[6] === undefined ? {} : { proximoReparto: aCantidad(m[6]) }),
    });
  }
  return filas;
}

/** Busca un prefijo de código en el catálogo en línea de Aldo y devuelve todas
 *  las filas de resultados, con caché en memoria y límite de concurrencia. */
export async function buscarAldo(termino: string, deps: DependenciasAldo = {}): Promise<ResultadoAldo[]> {
  const pedir = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = termino.trim().toUpperCase();
  const enCache = cacheBusqueda.get(clave);
  if (enCache && enCache.expira > ahora()) return enCache.valor;

  return conLimite(async () => {
    const reciente = cacheBusqueda.get(clave);
    if (reciente && reciente.expira > ahora()) return reciente.valor;

    const res = await pedir(...peticionAldo(termino, TIMEOUT_BUSQUEDA_MS, deps.env));
    if (!res.ok) throw new Error("Aldo no respondió");
    const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
    const filas = parsearFilas(html);
    const ttl = filas.length > 0 ? TTL_ENCONTRADO_MS : TTL_NO_ENCONTRADO_MS;
    cacheBusqueda.set(clave, { valor: filas, expira: ahora() + ttl });
    return filas;
  });
}

/**
 * Precio y existencia de Aldo para un código, con caché en memoria, límite de
 * concurrencia y cortacircuito. Nunca sube: si no se pudo preguntar, contesta
 * `{ encontrado: false, sinRespuesta: true }`, que NO se cachea.
 */
export async function precioAldo(codigo: string, deps: DependenciasAldo = {}): Promise<PrecioAldo> {
  const pedir = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = codigo.trim().toUpperCase();
  const enCache = cache.get(clave);
  if (enCache && enCache.expira > ahora()) return enCache.valor;

  return conLimite(async () => {
    // Doble verificación: otro request pudo cachearlo mientras esperábamos turno.
    const reciente = cache.get(clave);
    if (reciente && reciente.expira > ahora()) return reciente.valor;

    // Se decide aquí y no antes de la cola: los que esperaban turno mientras
    // fallaban los primeros ya encuentran el circuito abierto y no esperan nada.
    if (pedirPaso(ahora()) === "cortado") return SIN_RESPUESTA;

    let valor: PrecioAldo;
    try {
      valor = await consultarSitio(codigo, pedir, deps.env);
    } catch {
      // Falla de red o timeout: no se cachea, y cuenta para el cortacircuito.
      anotarFallo(ahora());
      return SIN_RESPUESTA;
    }
    anotarExito();
    const ttl = valor.encontrado ? TTL_ENCONTRADO_MS : TTL_NO_ENCONTRADO_MS;
    cache.set(clave, { valor, expira: ahora() + ttl });
    return valor;
  });
}
