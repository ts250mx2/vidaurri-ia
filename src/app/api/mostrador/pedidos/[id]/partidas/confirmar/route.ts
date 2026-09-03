import { exigirMostrador } from "@/lib/auth-mostrador";
import { confirmarPartidas } from "@/lib/db-pedidos";
import { idDeRuta, leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { validarConfirmacionPartidas } from "@/lib/pedidos";

// El mostrador dice renglón por renglón qué hay, qué no y qué se pide al
// proveedor (con los días prometidos). No mueve el estatus del pedido: eso lo
// hace /estatus cuando el vendedor termina de revisar.

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
  const validacion = validarConfirmacionPartidas(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const pedido = await confirmarPartidas(id, validacion.datos, sesion.usuario);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `confirmando partidas del pedido ${id}`);
  }
}
