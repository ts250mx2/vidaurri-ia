// Fotos que manda el cliente (la pieza dañada, una etiqueta con el número de
// parte, el golpe del coche) para que Vico las vea. Aquí se leen del cuerpo de
// la petición, se descargan con cuidado si llegan como URL y se normalizan.
// Solo servidor: usa sharp y hace peticiones de red.
//
// La pasarela puede mandarlas de dos formas, porque cada plataforma de WhatsApp
// ofrece una distinta: la URL del medio, o el archivo en base64.
//
// Descargar una URL que viene en el cuerpo de una petición es una puerta a la
// red interna (SSRF), así que: solo https, sin credenciales en la URL, nunca a
// direcciones privadas, cada redirección se vuelve a validar, hay tope de
// tamaño y de tiempo, y opcionalmente una lista blanca de hosts
// (WHATSAPP_MEDIA_HOSTS). El token para bajar el medio (WHATSAPP_MEDIA_AUTH)
// solo se manda a hosts de esa lista blanca: sin lista, no se manda a nadie.
//
// Toda imagen pasa por sharp antes de ir al modelo: corrige la orientación EXIF
// (las fotos de celular vienen "acostadas" y así no se lee una etiqueta), la
// reduce a LADO_MAX, la deja en JPEG y le quita los metadatos (el GPS del
// cliente no tiene por qué llegar al proveedor de IA). De paso valida: si los
// bytes no son una imagen, sharp no la abre.

import type { ImagenParaModelo } from "./vendedor";

export const MAX_IMAGENES = 3;
/** Tope de lo que se acepta recibir o descargar por imagen, antes de normalizar. */
export const BYTES_MAX = 8 * 1024 * 1024;
/** Lado mayor con que llega al modelo: más grande no mejora la lectura y cuesta tokens. */
const LADO_MAX = 1568;
const CALIDAD_JPEG = 85;
/** Defensa contra imágenes-bomba: ningún celular saca más de esto. */
const PIXELES_MAX = 50_000_000;
const TIMEOUT_MS = 10_000;
const REDIRECCIONES_MAX = 3;

export type ImagenEntrada = { tipo: "url"; url: string } | { tipo: "base64"; base64: string };

export class ImagenInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagenInvalidaError";
  }
}

/** Variables de entorno que importan aquí (process.env o un doble en pruebas). */
export type EntornoImagenes = Record<string, string | undefined>;

export interface DependenciasImagenes {
  fetch?: typeof fetch;
  env?: EntornoImagenes;
}

const DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

function entradaDe(valor: unknown): ImagenEntrada | null {
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return null;
    if (/^https?:\/\//i.test(texto)) return { tipo: "url", url: texto };
    if (DATA_URL.test(texto)) return { tipo: "base64", base64: texto.replace(DATA_URL, "") };
    return BASE64.test(texto) ? { tipo: "base64", base64: texto } : null;
  }
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    const { url, base64 } = valor as { url?: unknown; base64?: unknown };
    return entradaDe(typeof url === "string" && url.trim() ? url : base64);
  }
  return null;
}

export type LecturaImagenes = { ok: true; imagenes: ImagenEntrada[] } | { ok: false; error: string };

/**
 * Las fotos del cuerpo de la petición. Acepta `imagenes` (arreglo de URLs,
 * base64 u objetos { url } / { base64 }) y, para que mapear una sola variable
 * de la pasarela sea fácil, también `imagen` o `imagenUrl` con una sola.
 */
export function leerImagenesDelCuerpo(cuerpo: unknown): LecturaImagenes {
  if (typeof cuerpo !== "object" || cuerpo === null) return { ok: true, imagenes: [] };
  const { imagenes, imagen, imagenUrl } = cuerpo as Record<string, unknown>;
  const crudas = Array.isArray(imagenes) ? imagenes : [imagenes, imagen, imagenUrl];
  // Una variable de la pasarela sin valor llega como "" o null: eso no es una foto.
  const presentes = crudas.filter((v) => v !== undefined && v !== null && v !== "");
  if (presentes.length > MAX_IMAGENES) {
    return { ok: false, error: `Se aceptan hasta ${MAX_IMAGENES} imágenes por mensaje` };
  }
  const entradas = presentes.map(entradaDe);
  if (entradas.some((e) => e === null)) {
    return { ok: false, error: "Imagen inválida: manda la URL https del medio o el archivo en base64" };
  }
  return { ok: true, imagenes: entradas as ImagenEntrada[] };
}

function hostsPermitidos(env: EntornoImagenes): string[] {
  return (env.WHATSAPP_MEDIA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function enLista(host: string, lista: string[]): boolean {
  return lista.some((permitido) => host === permitido || host.endsWith(`.${permitido}`));
}

/** Direcciones a las que un servidor nunca debe ir a buscar algo que le pidieron desde fuera. */
function esDestinoPrivado(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return true; // IPv6 literal: nada legítimo de WhatsApp vive ahí
  const octetos = h.split(".");
  if (octetos.length !== 4 || octetos.some((o) => !/^\d{1,3}$/.test(o))) return false;
  // Una IPv4 literal nunca es el host de un medio de WhatsApp; las privadas, además, son peligrosas.
  return true;
}

/** La URL ya validada, o ImagenInvalidaError con el motivo. */
export function urlDeMediaPermitida(cruda: string, env: EntornoImagenes = process.env): URL {
  let url: URL;
  try {
    url = new URL(cruda);
  } catch {
    throw new ImagenInvalidaError("La URL de la imagen no es válida");
  }
  if (url.protocol !== "https:") throw new ImagenInvalidaError("La imagen debe venir por https");
  if (url.username || url.password) throw new ImagenInvalidaError("La URL de la imagen no puede llevar credenciales");
  const host = url.hostname.toLowerCase();
  if (esDestinoPrivado(host)) throw new ImagenInvalidaError("La URL de la imagen apunta a una dirección no permitida");
  const lista = hostsPermitidos(env);
  if (lista.length > 0 && !enLista(host, lista)) {
    throw new ImagenInvalidaError(`El host ${host} no está en WHATSAPP_MEDIA_HOSTS`);
  }
  return url;
}

/** Lee el cuerpo sin pasarse del tope: una respuesta enorme se corta, no se acumula. */
async function leerConTope(respuesta: Response): Promise<Buffer> {
  const declarado = Number(respuesta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > BYTES_MAX) throw new ImagenInvalidaError("La imagen es demasiado grande");
  if (!respuesta.body) return Buffer.from(await respuesta.arrayBuffer());

  const partes: Uint8Array[] = [];
  let total = 0;
  const lector = respuesta.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > BYTES_MAX) {
      await lector.cancel();
      throw new ImagenInvalidaError("La imagen es demasiado grande");
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/** Descarga el medio siguiendo las redirecciones a mano, para validar cada salto. */
export async function descargarImagen(cruda: string, deps: DependenciasImagenes = {}): Promise<Buffer> {
  const pedir = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const lista = hostsPermitidos(env);
  const token = env.WHATSAPP_MEDIA_AUTH?.trim();

  let url = urlDeMediaPermitida(cruda, env);
  for (let salto = 0; salto <= REDIRECCIONES_MAX; salto++) {
    // El token solo viaja a un host declarado en la lista blanca.
    const conToken = token && enLista(url.hostname.toLowerCase(), lista);
    let respuesta: Response;
    try {
      respuesta = await pedir(url, {
        redirect: "manual",
        headers: conToken ? { Authorization: token } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new ImagenInvalidaError("No se pudo descargar la imagen");
    }
    if (respuesta.status >= 300 && respuesta.status < 400) {
      const destino = respuesta.headers.get("location");
      if (!destino) throw new ImagenInvalidaError("La imagen redirige a ninguna parte");
      url = urlDeMediaPermitida(new URL(destino, url).toString(), env);
      continue;
    }
    if (!respuesta.ok) throw new ImagenInvalidaError(`No se pudo descargar la imagen (HTTP ${respuesta.status})`);
    return leerConTope(respuesta);
  }
  throw new ImagenInvalidaError("La imagen redirige demasiadas veces");
}

function bytesDeBase64(base64: string): Buffer {
  const limpio = base64.replace(/\s+/g, "");
  // 4 caracteres de base64 son 3 bytes: se revisa antes de decodificar.
  if (limpio.length * 0.75 > BYTES_MAX) throw new ImagenInvalidaError("La imagen es demasiado grande");
  const bytes = Buffer.from(limpio, "base64");
  if (bytes.byteLength === 0) throw new ImagenInvalidaError("La imagen viene vacía");
  return bytes;
}

/** Orientación corregida, tamaño acotado, JPEG y sin metadatos. Si no es una imagen, ImagenInvalidaError. */
export async function normalizarImagen(bytes: Buffer): Promise<ImagenParaModelo> {
  const { default: sharp } = await import("sharp");
  try {
    const jpeg = await sharp(bytes, { limitInputPixels: PIXELES_MAX })
      .rotate() // aplica la orientación EXIF y la descarta
      .resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: CALIDAD_JPEG })
      .toBuffer();
    return { mediaType: "image/jpeg", base64: jpeg.toString("base64") };
  } catch {
    throw new ImagenInvalidaError("El archivo no es una imagen que se pueda abrir");
  }
}

export interface ImagenesPreparadas {
  listas: ImagenParaModelo[];
  /** Cuántas no se pudieron abrir o descargar (el motivo queda en el log). */
  fallidas: number;
}

/**
 * Descarga (si hace falta) y normaliza cada foto. Nunca sube: una foto que no
 * se pudo abrir no debe dejar al cliente sin respuesta; se cuenta como fallida
 * y quien llama decide qué decirle.
 */
export async function prepararImagenes(
  entradas: ImagenEntrada[],
  deps: DependenciasImagenes = {}
): Promise<ImagenesPreparadas> {
  const resultados = await Promise.allSettled(
    entradas.map(async (entrada) =>
      normalizarImagen(entrada.tipo === "url" ? await descargarImagen(entrada.url, deps) : bytesDeBase64(entrada.base64))
    )
  );
  const listas: ImagenParaModelo[] = [];
  let fallidas = 0;
  for (const resultado of resultados) {
    if (resultado.status === "fulfilled") {
      listas.push(resultado.value);
    } else {
      fallidas++;
      console.warn("[fotos] no se pudo usar una imagen del cliente:", resultado.reason);
    }
  }
  return { listas, fallidas };
}
