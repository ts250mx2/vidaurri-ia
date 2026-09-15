import { exigirKiosco } from "@/lib/auth-kiosco";
import { agregarPartida, crearBorrador, obtenerBorrador } from "@/lib/db-pedidos";
import {
  AREA_KIOSCO,
  CANAL_KIOSCO,
  USUARIO_KIOSCO,
  actorCapturaKiosco,
  datosBorradorKiosco,
  pedidoParaKiosco,
} from "@/lib/kiosco-api";
import { leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { validarCapturaPartida } from "@/lib/pedidos";
import { cotizarPartida } from "@/lib/mostrador-cotizacion";

// Agrega una pieza al pedido del kiosco. El precio lo resuelve cotizarPartida
// (precio de MOSTRADOR: el borrador nace con idCliente null y descuento 0),
// nunca el cliente HTTP. Si el aparato todavía no tenía pedido en curso, se
// abre aquí: en el kiosco no hay un paso previo de "elegir cliente".

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;
  const actor = actorCapturaKiosco(guardia.kiosco);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCapturaPartida(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    // Nunca por crearBorrador a secas: si el cliente ya tecleó su nombre (la
    // pantalla de datos) y regresa a agregar otra pieza, abrir el borrador
    // "para público general" cancelaría el suyo con todo lo capturado.
    const borrador =
      (await obtenerBorrador(actor)) ?? (await crearBorrador(actor, datosBorradorKiosco(guardia.kiosco)));

    const cotizacion = await cotizarPartida(validacion.datos, borrador);
    if (!cotizacion.ok) return respuestaError(cotizacion.error, cotizacion.status);

    const pedido = await agregarPartida(borrador.id, cotizacion.partida, USUARIO_KIOSCO, CANAL_KIOSCO);
    return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
  } catch (error) {
    return respuestaDeError(error, "agregando una pieza al pedido del kiosco", AREA_KIOSCO);
  }
}
