import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerPedido } from "@/lib/db-pedidos";
import { idDeRuta, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Detalle de un pedido (cabecera, partidas y bitácora) para la pantalla del mostrador.

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
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `leyendo el pedido ${id}`);
  }
}
