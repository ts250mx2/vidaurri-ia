import { NextResponse } from "next/server";
import { apiKeyValida } from "@/lib/api-key";
import { leerIdRuta, type ClienteDescuento } from "@/lib/clientes-descuento";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";

// Guardia de las rutas /api/clientes/*: el área de clientes, a la que el
// cliente del padrón entra desde su propio dispositivo (o desde la PC de la
// tienda) con celular y contraseña.
//
// vidaurri-page guarda la cookie del cliente (JWT propio, audiencia
// "clientes", que verifica allá) y en cada llamada al motor manda su API key
// de servidor a servidor y la cabecera X-Cliente con el id del cliente. El
// motor no ve esa cookie: lo único que confía es el id, y solo si el padrón
// lo sigue teniendo (se revalida en cada llamada).
//
// Este guardia NUNCA mira el Authorization (el JWT del mostrador no abre el
// área de clientes) ni las cabeceras del kiosco (X-Kiosco / X-Kiosco-Cliente):
// son puertas distintas a propósito. El cliente solo sabe armar SU pedido y
// ver SUS pedidos.

export const CABECERA_CLIENTE = "x-cliente";

/** Un cliente del padrón que sí tiene celular: su borrador es c:<celular> (la
 *  misma clave que WhatsApp), así que sin celular no hay con qué operar. */
export type ClienteConCelular = ClienteDescuento & { telefono: string };

/** Qué capa rechazó: la llave de vidaurri-page o la cabecera del cliente (falta,
 *  id malformado, o ya no está en el padrón). */
export type CodigoNoAutorizadoCliente = "api_key" | "cliente";

const ERROR_NO_AUTORIZADO: Record<CodigoNoAutorizadoCliente, string> = {
  api_key: "Servicio no autorizado",
  cliente: "Tu sesión ya no es válida; vuelve a entrar con tu celular y tu contraseña",
};
const ERROR_PADRON = "No fue posible consultar la base de datos";

export function respuestaNoAutorizadoCliente(codigo: CodigoNoAutorizadoCliente): NextResponse {
  return NextResponse.json({ ok: false, error: ERROR_NO_AUTORIZADO[codigo], codigo }, { status: 401 });
}

export type ResultadoRevalidarCliente =
  | { ok: true; cliente: ClienteConCelular }
  | { ok: false; respuesta: NextResponse };

/**
 * Resuelve un id de cliente contra el padrón. Si el padrón no responde la
 * puerta se cierra (502): atender "mientras tanto" a precio de mostrador a
 * alguien que entró como cliente sería cobrarle de más sin que nadie se
 * entere, y adivinarle el descuento sería peor. La comparten este guardia y
 * el del kiosco (X-Kiosco-Cliente): es la misma pregunta.
 */
export async function revalidarCliente(idCliente: number, area: string): Promise<ResultadoRevalidarCliente> {
  try {
    const cliente = await obtenerClienteDescuento(idCliente);
    if (!cliente || !cliente.telefono) return { ok: false, respuesta: respuestaNoAutorizadoCliente("cliente") };
    return { ok: true, cliente: { ...cliente, telefono: cliente.telefono } };
  } catch (error) {
    console.error(`[${area}] revalidando al cliente #${idCliente} en el padrón:`, error);
    return { ok: false, respuesta: NextResponse.json({ ok: false, error: ERROR_PADRON }, { status: 502 }) };
  }
}

export type ResultadoExigirCliente =
  | { ok: true; cliente: ClienteConCelular }
  | { ok: false; respuesta: NextResponse };

/**
 * Guardia estándar de toda ruta /api/clientes/* (menos entrar, que no tiene
 * cliente todavía): la API key de vidaurri-page (MOSTRADOR_API_KEY: es la
 * misma página llamando al mismo motor) y X-Cliente con un entero positivo
 * que siga en el padrón. Los fallos son 401 con `codigo` distinto para que la
 * página sepa si es la llave rotada o una sesión que ya no sirve.
 */
export async function exigirCliente(request: Request): Promise<ResultadoExigirCliente> {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) {
    return { ok: false, respuesta: respuestaNoAutorizadoCliente("api_key") };
  }
  const idCliente = leerIdRuta(request.headers.get(CABECERA_CLIENTE)?.trim() ?? "");
  if (idCliente === null) return { ok: false, respuesta: respuestaNoAutorizadoCliente("cliente") };
  return revalidarCliente(idCliente, "clientes");
}
