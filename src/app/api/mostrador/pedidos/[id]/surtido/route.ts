import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerPedido } from "@/lib/db-pedidos";
import { armarHojaSurtido } from "@/lib/hoja-surtido";
import { idDeRuta, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Hoja de surtido imprimible: el pedido con la existencia releída ahora mismo
// de bdav / Bodega Usado y la ubicación física de las usadas.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  try {
    const pedido = await obtenerPedido(id);
    if (!pedido) return respuestaError("El pedido no existe", 404);
    const hoja = await armarHojaSurtido(pedido);
    return respuestaOk({ hoja });
  } catch (error) {
    return respuestaDeError(error, `armando la hoja de surtido del pedido ${id}`);
  }
}
