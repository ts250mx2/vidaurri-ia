import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerPedido } from "@/lib/db-pedidos";
import { idDeRuta, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { puedeCotizarEnPos, sincronizarCotizacionPos } from "@/lib/pos-cotiza";

// Reintento manual de la cotización en el POS (botón "Reintentar" del detalle
// cuando quedó en error, o para volver a simular). Solo tiene sentido en un
// pedido que el mostrador ya surtió (listo o entregado); si ya está insertada
// no se duplica: sincronizarCotizacionPos la deja como está.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  try {
    const pedido = await obtenerPedido(id);
    if (!pedido) return respuestaError("El pedido no existe", 404);
    if (!puedeCotizarEnPos(pedido.estatus)) {
      return respuestaError("Solo se cotiza en el POS un pedido listo o entregado", 409);
    }
    const actualizado = await sincronizarCotizacionPos(id, sesion.usuario);
    return respuestaOk({ pedido: actualizado });
  } catch (error) {
    return respuestaDeError(error, `cotizando en el POS el pedido ${id}`);
  }
}
