import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarSucursal, enviarPedido, obtenerBorrador } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  ERROR_SIN_BORRADOR,
  actorDe,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarEnvioBorrador } from "@/lib/pedidos";

// borrador → enviado: el pedido recibe folio y entra a la cola del mostrador.
// Si el vendedor cambió la sucursal al final, se aplica antes de enviar para
// que el evento "enviado" ya diga dónde se recoge.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarEnvioBorrador(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);
  const { observaciones, sucursal } = validacion.datos;

  try {
    const borrador = await obtenerBorrador(actorDe(sesion));
    if (!borrador) return respuestaError(ERROR_SIN_BORRADOR, 404);

    if (sucursal !== null && sucursal !== borrador.sucursal) {
      await cambiarSucursal(borrador.id, sucursal, sesion.usuario, CANAL_MOSTRADOR);
    }
    const pedido = await enviarPedido(borrador.id, sesion.usuario, CANAL_MOSTRADOR, observaciones);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, "enviando el borrador del vendedor");
  }
}
