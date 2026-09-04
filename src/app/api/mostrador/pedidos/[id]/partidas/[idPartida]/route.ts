import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarCantidadPartida, quitarPartida } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarCantidad } from "@/lib/pedidos";

// Un renglón de un pedido editable (borrador, enviado o confirmado): PATCH
// cambia la cantidad, DELETE lo quita. La partida tiene que ser de ESE pedido:
// un id de otro se reporta como inexistente. Si el pedido ya no se puede
// editar, la capa de datos contesta 409.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string; idPartida: string }> };

/** Los dos identificadores de la ruta, o null si alguno no es un entero positivo. */
async function idsDeRuta(params: Contexto["params"]): Promise<{ id: number; idPartida: number } | null> {
  const id = await idDeRuta(params, "id");
  const idPartida = await idDeRuta(params, "idPartida");
  return id === null || idPartida === null ? null : { id, idPartida };
}

export async function PATCH(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const ids = await idsDeRuta(contexto.params);
  if (!ids) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCantidad(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const pedido = await cambiarCantidadPartida(
      ids.id,
      ids.idPartida,
      validacion.datos.cantidad,
      sesion.usuario,
      CANAL_MOSTRADOR
    );
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando la cantidad de la partida ${ids.idPartida} del pedido ${ids.id}`);
  }
}

export async function DELETE(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const ids = await idsDeRuta(contexto.params);
  if (!ids) return respuestaError("Identificador inválido", 400);

  try {
    const pedido = await quitarPartida(ids.id, ids.idPartida, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `quitando la partida ${ids.idPartida} del pedido ${ids.id}`);
  }
}
