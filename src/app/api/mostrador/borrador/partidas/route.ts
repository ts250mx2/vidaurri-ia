import { exigirMostrador } from "@/lib/auth-mostrador";
import { agregarPartida, obtenerBorrador } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  ERROR_SIN_BORRADOR,
  actorDe,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { cotizarPartida } from "@/lib/mostrador-cotizacion";
import { validarCapturaPartida } from "@/lib/pedidos";

// Agrega un renglón al borrador del vendedor. El precio lo resuelve
// cotizarPartida con el descuento ACTUAL del cliente del borrador; nunca lo
// manda el cliente HTTP.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCapturaPartida(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const borrador = await obtenerBorrador(actorDe(sesion));
    if (!borrador) return respuestaError(ERROR_SIN_BORRADOR, 404);

    const cotizacion = await cotizarPartida(validacion.datos, borrador);
    if (!cotizacion.ok) return respuestaError(cotizacion.error, cotizacion.status);

    const pedido = await agregarPartida(borrador.id, cotizacion.partida, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, "agregando una partida al borrador");
  }
}
