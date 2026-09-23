import crypto from "node:crypto";

// Enlace público al PDF de un pedido, para mandarlo por WhatsApp: el cliente
// lo abre sin sesión, así que la URL lleva una firma HMAC del id (derivada de
// JWT_SECRET) que nadie puede adivinar ni cambiar por la de otro pedido.

/** 128 bits en hex: suficiente para que no se adivine y corto para un chat. */
const FIRMA_HEX = 32;
const ETIQUETA = "pedido-pdf";
/** Otra etiqueta (otra firma) para la COTIZACIÓN: abre también borradores, así que la liga del pedido no debe servir para ella ni al revés. */
const ETIQUETA_COTIZACION = "cotizacion-pdf";
const RUTA_PDF = "/api/pedidos";

export const FIRMA_VALIDA = /^[0-9a-f]{32}$/;

function secreto(): string | null {
  const clave = process.env.JWT_SECRET?.trim();
  return clave || null;
}

function firmar(etiqueta: string, id: number): string | null {
  const clave = secreto();
  if (!clave || !Number.isInteger(id) || id <= 0) return null;
  return crypto.createHmac("sha256", clave).update(`${etiqueta}:${id}`).digest("hex").slice(0, FIRMA_HEX);
}

/** Firma del pedido; null si el servidor no tiene JWT_SECRET (no hay enlace). */
export function firmaPedido(id: number): string | null {
  return firmar(ETIQUETA, id);
}

/** Firma de la cotización del pedido (borrador incluido); null sin JWT_SECRET. */
export function firmaCotizacion(id: number): string | null {
  return firmar(ETIQUETA_COTIZACION, id);
}

function coincide(esperada: string | null, firma: string): boolean {
  if (!FIRMA_VALIDA.test(firma) || !esperada) return false;
  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
}

/** Comparación en tiempo constante; false ante cualquier duda. */
export function firmaValida(id: number, firma: string): boolean {
  return coincide(firmaPedido(id), firma);
}

export function firmaCotizacionValida(id: number, firma: string): boolean {
  return coincide(firmaCotizacion(id), firma);
}

/** 'https://vidaurri.hlsistemas.com/api/pedidos/21/pdf?f=…'; null sin base o sin secreto. */
export function urlPdfPedido(base: string, id: number): string | null {
  const origen = base.trim().replace(/\/+$/, "");
  const firma = firmaPedido(id);
  if (!origen || !firma) return null;
  return `${origen}${RUTA_PDF}/${id}/pdf?f=${firma}`;
}

/** 'https://apvidaurri.com/cotizacion/228?c=…': la cotización en la página pública, para verla y firmarla. */
export function urlCotizacionPagina(basePagina: string, id: number): string | null {
  const origen = basePagina.trim().replace(/\/+$/, "");
  const firma = firmaCotizacion(id);
  if (!origen || !firma) return null;
  return `${origen}/cotizacion/${id}?c=${firma}`;
}

/** 'https://vidaurri.hlsistemas.com/api/pedidos/228/pdf?c=…': la cotización, que abre aunque sea borrador. */
export function urlPdfCotizacion(base: string, id: number): string | null {
  const origen = base.trim().replace(/\/+$/, "");
  const firma = firmaCotizacion(id);
  if (!origen || !firma) return null;
  return `${origen}${RUTA_PDF}/${id}/pdf?c=${firma}`;
}
