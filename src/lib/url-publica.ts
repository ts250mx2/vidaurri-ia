// Origen público del sistema (https://vidaurri.hlsistemas.com), para armar URLs
// absolutas que alguien de fuera tenga que abrir: las fotos que se mandan por
// WhatsApp y las páginas a las que Stripe regresa tras un pago.

/** PUBLIC_BASE_URL del .env sin diagonal final; '' si no está configurada. */
export function baseUrlConfigurada(): string {
  return process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

/**
 * PUBLIC_BASE_URL o, si falta, el Host de la petición. Sirve para las fotos de
 * WhatsApp; NO para las URLs de regreso de un pago: el Host lo manda el
 * cliente y ahí conviene fallar en vez de confiar en él (baseUrlConfigurada).
 */
export function baseUrlPublica(request: Request): string {
  const configurada = baseUrlConfigurada();
  if (configurada) return configurada;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (!host) return "";
  // WhatsApp exige HTTPS para los medios; el host público ya redirige a HTTPS.
  const protocolo = request.headers.get("x-forwarded-proto") ?? "https";
  return `${protocolo}://${host}`;
}
