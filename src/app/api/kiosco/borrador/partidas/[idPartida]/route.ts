import { exigirKiosco } from "@/lib/auth-kiosco";
import { cambiarCantidadPartida, obtenerBorrador, quitarPartida } from "@/lib/db-pedidos";
import {
  AREA_KIOSCO,
  CANAL_KIOSCO,
  ERROR_SIN_PEDIDO_KIOSCO,
  USUARIO_KIOSCO,
  actorCapturaKiosco,
  pedidoParaKiosco,
} from "@/lib/kiosco-api";
import { idDeRuta, leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { validarCantidad } from "@/lib/pedidos";

// Un renglón del pedido del kiosco: PATCH cambia la cantidad (los botones ±
// de la pantalla), DELETE lo quita. La partida tiene que ser del pedido de
// ESTE aparato: un id de otro pedido se reporta como inexistente, así que
// desde el kiosco no se puede tocar ni mirar lo de nadie más.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ idPartida: string }> };

export async function PATCH(request: Request, contexto: Contexto) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;

  const idPartida = await idDeRuta(contexto.params, "idPartida");
  if (idPartida === null) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCantidad(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const borrador = await obtenerBorrador(actorCapturaKiosco(guardia.kiosco));
    if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);

    const pedido = await cambiarCantidadPartida(
      borrador.id,
      idPartida,
      validacion.datos.cantidad,
      USUARIO_KIOSCO,
      CANAL_KIOSCO
    );
    return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
  } catch (error) {
    return respuestaDeError(error, `cambiando la cantidad de la partida ${idPartida} en el kiosco`, AREA_KIOSCO);
  }
}

export async function DELETE(request: Request, contexto: Contexto) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;

  const idPartida = await idDeRuta(contexto.params, "idPartida");
  if (idPartida === null) return respuestaError("Identificador inválido", 400);

  try {
    const borrador = await obtenerBorrador(actorCapturaKiosco(guardia.kiosco));
    if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);

    const pedido = await quitarPartida(borrador.id, idPartida, USUARIO_KIOSCO, CANAL_KIOSCO);
    return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
  } catch (error) {
    return respuestaDeError(error, `quitando la partida ${idPartida} en el kiosco`, AREA_KIOSCO);
  }
}
