import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerPedido } from "@/lib/db-pedidos";
import { armarHojaBackorder } from "@/lib/hoja-backorder";
import { idDeRuta, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { puedeTenerBackorder } from "@/lib/pedidos";
import { sincronizarBackorderPos } from "@/lib/pos-backorder";

// La back order a Aldo del pedido. GET: la hoja imprimible (orden de compra)
// con los renglones sobre pedido, el proveedor y cómo va en el POS. POST:
// reintento manual (botón "Reintentar" del detalle cuando quedó en error o
// pendiente); solo tiene sentido en un pedido que el mostrador ya confirmó, y
// no duplica: sincronizarBackorderPos respeta la vigente si no cambió nada.

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
    const hoja = await armarHojaBackorder(pedido);
    return respuestaOk({ hoja });
  } catch (error) {
    return respuestaDeError(error, `armando la hoja de back order del pedido ${id}`);
  }
}

export async function POST(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  try {
    const pedido = await obtenerPedido(id);
    if (!pedido) return respuestaError("El pedido no existe", 404);
    if (!puedeTenerBackorder(pedido.estatus)) {
      return respuestaError("Solo se pide a Aldo un pedido confirmado, listo o entregado", 409);
    }
    const actualizado = await sincronizarBackorderPos(id, sesion.usuario);
    return respuestaOk({ pedido: actualizado });
  } catch (error) {
    return respuestaDeError(error, `pidiendo a Aldo la back order del pedido ${id}`);
  }
}
