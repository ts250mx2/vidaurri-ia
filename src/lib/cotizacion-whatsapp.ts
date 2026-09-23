import { AXON_URL_BASE_DEFAULT, esTimeout, motivoPorEstado } from "./axon";
import { moneda } from "./formato";
import type { PedidoDetalle } from "./pedidos";
import { telefonoE164 } from "./whatsapp-bienvenida";

// La cotización de un pedido (normalmente un borrador todavía en captura) que
// el mostrador le manda al cliente por WhatsApp: un mensaje de texto con el
// resumen y la liga firmada al PDF (`/api/pedidos/[id]/pdf?c=…`, que abre sin
// sesión). Sale por la pasarela de Axon Logic, `POST /v1/outbound/alert`
// —texto y nada más: la pasarela no manda archivos, por eso va la liga—, la
// misma que usan las alertas de los otros sistemas de la casa. Ese endpoint
// tiene SU PROPIA API key por aplicación (`axon_…`, AXON_OUTBOUND_API_KEY),
// distinta de la key pública `axk_…` de la bienvenida y el saldo: con la
// pública responde "API key rechazada".
//
// Nunca lanza: el que llama decide qué contarle al vendedor con `motivo`.

const RUTA_SALIDA = "/v1/outbound/alert";
const TIMEOUT_MS = 15_000;
const DETALLE_LOG_MAX = 300;
export const MOTIVO_SIN_KEY_SALIDA = "falta configurar AXON_OUTBOUND_API_KEY en el servidor (la key de salida de Axon Logic)";

function configuracionSalida(): { url: string; apiKey: string } | null {
  const apiKey = process.env.AXON_OUTBOUND_API_KEY?.trim();
  if (!apiKey) return null;
  const base = (process.env.AXON_API_URL?.trim() || AXON_URL_BASE_DEFAULT).replace(/\/+$/, "");
  return { url: `${base}${RUTA_SALIDA}`, apiKey };
}
/** Con qué se firma el envío en Axon Logic (aparece en su bitácora). */
const APP_ORIGEN = "vidaurri-ia";
/** Piezas que se listan en el mensaje; el resto va en el PDF. */
const RENGLONES_MAX = 6;

export interface EnvioCotizacion {
  ok: boolean;
  /** Para el vendedor cuando `ok` es false: sin datos técnicos ni la API key. */
  motivo?: string;
}

/** 'Cotización #228' o, si el pedido ya tiene folio, 'Cotización del pedido P-000228'. */
export function tituloCotizacion(pedido: PedidoDetalle): string {
  return pedido.folio ? `Cotización del pedido ${pedido.folio}` : `Cotización #${pedido.id}`;
}

/**
 * El mensaje, con formato de WhatsApp (*negritas*, saltos). Nombra al cliente,
 * lista las primeras piezas con su precio con IVA, el total y la liga al PDF.
 * Honesto como todo lo del pedido: precios con IVA, sujetos a existencia, y
 * no es un pedido hasta que se envíe.
 */
export function textoCotizacionWhatsapp(pedido: PedidoDetalle, url: string, conFirma = false): string {
  const renglones = pedido.partidas
    .slice(0, RENGLONES_MAX)
    .map((p) => `• ${p.cantidad} × ${p.descripcion} — ${moneda(p.precioUnitario)}`);
  const faltan = pedido.partidas.length - renglones.length;
  if (faltan > 0) renglones.push(`• …y ${faltan} ${faltan === 1 ? "pieza más" : "piezas más"} (ver PDF)`);
  const saludo = pedido.cliente && pedido.cliente !== "Público general" ? `Hola, *${pedido.cliente}*.` : "Hola.";
  return [
    `${saludo} Te mandamos tu *${tituloCotizacion(pedido).toLowerCase()}* de Autopartes Vidaurri:`,
    "",
    ...renglones,
    "",
    `*Total: ${moneda(pedido.total)}* (IVA incluido)`,
    "",
    conFirma ? `📝 Revísala y fírmala aquí para convertirla en pedido: ${url}` : `📄 Cotización en PDF: ${url}`,
    "",
    conFirma
      ? "Precios sujetos a existencia. Al firmarla queda como pedido y el mostrador te avisa cuando esté listo."
      : "Precios sujetos a existencia. Cuando quieras la convertimos en pedido: respóndenos por aquí o pasa al mostrador.",
  ].join("\n");
}

/** Manda el texto al celular (10 dígitos nacionales) por la salida de Axon Logic. */
export async function enviarTextoWhatsapp(telefono: string, texto: string, etiqueta: string): Promise<EnvioCotizacion> {
  const to = telefonoE164(telefono);
  if (!to) return { ok: false, motivo: "el celular no es un número válido" };
  const config = configuracionSalida();
  if (!config) {
    console.warn(`${etiqueta}: ${MOTIVO_SIN_KEY_SALIDA}`);
    return { ok: false, motivo: MOTIVO_SIN_KEY_SALIDA };
  }
  let respuesta: Response;
  try {
    respuesta = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body: JSON.stringify({ to, message: texto, source_app: APP_ORIGEN }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const motivo = esTimeout(error) ? "Axon Logic no respondió a tiempo" : "no se pudo conectar con Axon Logic";
    console.error(`${etiqueta}: ${motivo}`, error);
    return { ok: false, motivo };
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    console.error(`${etiqueta}: HTTP ${respuesta.status} ${cuerpo.slice(0, DETALLE_LOG_MAX)}`);
    return { ok: false, motivo: motivoPorEstado(respuesta.status) };
  }
  return { ok: true };
}
