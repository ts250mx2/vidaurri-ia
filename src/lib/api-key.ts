import crypto from "node:crypto";

// API keys servidor→servidor. Cada canal externo tiene su propia variable para
// poder rotar una sin tumbar la otra: WHATSAPP_API_KEY la usa la pasarela de
// WhatsApp (Axon) y MOSTRADOR_API_KEY la usa vidaurri-page para /api/mostrador/*.
export type VariableApiKey = "WHATSAPP_API_KEY" | "MOSTRADOR_API_KEY";

/**
 * Compara dos secretos en tiempo constante. timingSafeEqual exige buffers del
 * mismo largo, así que la longitud se revisa antes; el largo de la key no es
 * un secreto que valga la pena esconder.
 */
export function comparaSecretoSeguro(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * ¿La petición trae la API key correcta en `X-API-Key`? Solo se lee ese header:
 * en /api/mostrador/* el `Authorization` lleva el Bearer del vendedor, no la key.
 * Sin la variable configurada la puerta queda cerrada (nunca abierta por defecto).
 */
export function apiKeyValida(request: Request, variable: VariableApiKey): boolean {
  const esperada = process.env[variable];
  if (!esperada) return false;
  const recibida = (request.headers.get("x-api-key") ?? "").trim();
  if (!recibida) return false;
  return comparaSecretoSeguro(recibida, esperada);
}
