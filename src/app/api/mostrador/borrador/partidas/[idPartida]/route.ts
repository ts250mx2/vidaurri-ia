import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarCantidadPartida, obtenerBorrador, quitarPartida } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  ERROR_SIN_BORRADOR,
  actorDe,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarCantidad } from "@/lib/pedidos";

// Un renglón del borrador del vendedor: PATCH cambia la cantidad, DELETE lo
// quita. La partida tiene que ser de SU borrador: un id de otro pedido se
// reporta como inexistente.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ idPartida: string }> };

export async function PATCH(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const idPartida = await idDeRuta(contexto.params, "idPartida");
  if (idPartida === null) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCantidad(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const borrador = await obtenerBorrador(actorDe(sesion));
    if (!borrador) return respuestaError(ERROR_SIN_BORRADOR, 404);

    const pedido = await cambiarCantidadPartida(
      borrador.id,
      idPartida,
      validacion.datos.cantidad,
      sesion.usuario,
      CANAL_MOSTRADOR
    );
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando la cantidad de la partida ${idPartida} del borrador`);
  }
}

export async function DELETE(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const idPartida = await idDeRuta(contexto.params, "idPartida");
  if (idPartida === null) return respuestaError("Identificador inválido", 400);

  try {
    const borrador = await obtenerBorrador(actorDe(sesion));
    if (!borrador) return respuestaError(ERROR_SIN_BORRADOR, 404);

    const pedido = await quitarPartida(borrador.id, idPartida, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `quitando la partida ${idPartida} del borrador`);
  }
}
