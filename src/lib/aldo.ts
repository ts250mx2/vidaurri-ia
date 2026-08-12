// Consulta el precio público de un artículo en el catálogo en línea de Aldo
// Autopartes (pi_resultados.jsp), parseando el HTML de resultados. Se cachea en
// memoria por código y se limita la concurrencia real contra su sitio para no
// saturarlo cuando la tabla del catálogo pide muchos códigos a la vez.

const URL_BUSQUEDA = "http://www.aldoautopartes.com/pi_resultados.jsp";
const TIMEOUT_MS = 15000;
const TTL_ENCONTRADO_MS = 30 * 60 * 1000; // 30 min si trajo precio
const TTL_NO_ENCONTRADO_MS = 5 * 60 * 1000; // 5 min si no estaba (permite reintento)
const MAX_CONCURRENTE = 4; // peticiones simultáneas máximas al sitio de Aldo

// Entidades HTML que aparecen en las descripciones (el sitio es ISO-8859-1).
const ENTIDADES: Record<string, string> = {
  "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú",
  "&Aacute;": "Á", "&Eacute;": "É", "&Iacute;": "Í", "&Oacute;": "Ó", "&Uacute;": "Ú",
  "&ntilde;": "ñ", "&Ntilde;": "Ñ", "&nbsp;": " ", "&amp;": "&",
};

export interface PrecioAldo {
  encontrado: boolean;
  descripcion?: string;
  /** Precio de lista de Aldo sin IVA. */
  sinIva?: number;
  /** Precio de lista de Aldo con IVA. */
  conIva?: number;
  /** Existencia en Aldo: número exacto o una etiqueta como "Mas de 60". */
  existencia?: number | string;
}

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

function textoPlano(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z]+;/g, (m) => ENTIDADES[m] ?? " ")
    .replace(/\s+/g, " ");
}

function parsear(html: string, codigo: string): PrecioAldo {
  const t = textoPlano(html);
  const objetivo = codigo.trim().toUpperCase();
  const pos = t.toUpperCase().indexOf(objetivo);
  if (pos < 0) return { encontrado: false };

  // Tras el código: descripción, $ sin IVA, $ con IVA, existencia (número o "Mas de N").
  const resto = t.slice(pos + objetivo.length);
  const m = resto.match(/^\s+(.+?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(Mas de \d+|[\d.]+)/i);
  if (!m) return { encontrado: false };

  const num = (s: string) => parseFloat(s.replace(/,/g, ""));
  const existBruta = m[4];
  return {
    encontrado: true,
    descripcion: m[1].trim(),
    sinIva: num(m[2]),
    conIva: num(m[3]),
    existencia: /Mas de/i.test(existBruta) ? existBruta : num(existBruta),
  };
}

async function consultarSitio(codigo: string): Promise<PrecioAldo> {
  try {
    const res = await fetch(URL_BUSQUEDA, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
      body: "codigo=" + encodeURIComponent(codigo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { encontrado: false };
    // El sitio responde en ISO-8859-1: se decodifica el buffer como latin1.
    const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
    return parsear(html, codigo);
  } catch {
    // Timeout o falla de red: no encontrado (sin cachear el fallo de red).
    throw new Error("fallo de red");
  }
}

/** Devuelve el precio de Aldo para un código, con caché en memoria y límite
 *  de concurrencia contra su sitio. */
export async function precioAldo(codigo: string): Promise<PrecioAldo> {
  const clave = codigo.trim().toUpperCase();
  const enCache = cache.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.valor;

  return conLimite(async () => {
    // Doble verificación: otro request pudo cachearlo mientras esperábamos turno.
    const reciente = cache.get(clave);
    if (reciente && reciente.expira > Date.now()) return reciente.valor;

    let valor: PrecioAldo;
    try {
      valor = await consultarSitio(codigo);
    } catch {
      // Falla de red transitoria: no cachear, para reintentar luego.
      return { encontrado: false };
    }
    const ttl = valor.encontrado ? TTL_ENCONTRADO_MS : TTL_NO_ENCONTRADO_MS;
    cache.set(clave, { valor, expira: Date.now() + ttl });
    return valor;
  });
}
