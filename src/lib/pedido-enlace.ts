import crypto from "node:crypto";

// Enlace público al PDF de un pedido, para mandarlo por WhatsApp: el cliente
// lo abre sin sesión, así que la URL lleva una firma HMAC del id (derivada de
// JWT_SECRET) que nadie puede adivinar ni cambiar por la de otro pedido.

/** 128 bits en hex: suficiente para que no se adivine y corto para un chat. */
const FIRMA_HEX = 32;
const ETIQUETA = "pedido-pdf";
const RUTA_PDF = "/api/pedidos";

export const FIRMA_VALIDA = /^[0-9a-f]{32}$/;

function secreto(): string | null {
  const clave = process.env.JWT_SECRET?.trim();
  return clave || null;
}

/** Firma del pedido; null si el servidor no tiene JWT_SECRET (no hay enlace). */
export function firmaPedido(id: number): string | null {
  const clave = secreto();
  if (!clave || !Number.isInteger(id) || id <= 0) return null;
  return crypto.createHmac("sha256", clave).update(`${ETIQUETA}:${id}`).digest("hex").slice(0, FIRMA_HEX);
}

/** Comparación en tiempo constante; false ante cualquier duda. */
export function firmaValida(id: number, firma: string): boolean {
  if (!FIRMA_VALIDA.test(firma)) return false;
  const esperada = firmaPedido(id);
  if (!esperada) return false;
  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
}

/** 'https://vidaurri.hlsistemas.com/api/pedidos/21/pdf?f=…'; null sin base o sin secreto. */
export function urlPdfPedido(base: string, id: number): string | null {
  const origen = base.trim().replace(/\/+$/, "");
  const firma = firmaPedido(id);
  if (!origen || !firma) return null;
  return `${origen}${RUTA_PDF}/${id}/pdf?f=${firma}`;
}
