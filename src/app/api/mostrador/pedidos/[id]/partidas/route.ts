import { exigirMostrador } from "@/lib/auth-mostrador";
import { PedidoNoEditableError, agregarPartida, obtenerPedido } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { cotizarPartida } from "@/lib/mostrador-cotizacion";
import { puedeEditarPedido, validarCapturaPartida } from "@/lib/pedidos";

// Agrega un renglón a un pedido editable (borrador, enviado o confirmado)
// desde el detalle del mostrador. Se cotiza igual que en el borrador: con el
// descuento ACTUAL del cliente del pedido. En un pedido confirmado la partida
// nueva nace pendiente, para que el mostrador la confirme como a las demás.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCapturaPartida(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const actual = await obtenerPedido(id);
    if (!actual) return respuestaError("El pedido no existe", 404);
    // Se revisa antes de cotizar para no ir a bdav por un pedido que ya no
    // admite cambios; la capa de datos lo vuelve a comprobar con la fila bloqueada.
    if (!puedeEditarPedido(actual.estatus)) throw new PedidoNoEditableError(actual.estatus);

    const cotizacion = await cotizarPartida(validacion.datos, actual);
    if (!cotizacion.ok) return respuestaError(cotizacion.error, cotizacion.status);

    const pedido = await agregarPartida(id, cotizacion.partida, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `agregando una partida al pedido ${id}`);
  }
}
