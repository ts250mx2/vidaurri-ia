import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerBorrador, quitarPartida } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  ERROR_SIN_BORRADOR,
  actorDe,
  idDeRuta,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";

// Quita un renglón del borrador del vendedor. La partida tiene que ser de SU
// borrador: un id de otro pedido se reporta como inexistente.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ idPartida: string }> };

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
