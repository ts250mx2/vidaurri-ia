import { exigirMostrador } from "@/lib/auth-mostrador";
import { confirmarPartidas } from "@/lib/db-pedidos";
import { idDeRuta, leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { validarConfirmacionPartidas } from "@/lib/pedidos";
import { sincronizarBackorderPos } from "@/lib/pos-backorder";

// El mostrador dice renglón por renglón qué hay, qué no y qué se pide al
// proveedor (con los días prometidos). No mueve el estatus del pedido: eso lo
// hace /estatus cuando el vendedor termina de revisar. Si el pedido ya está
// confirmado, lo que se marcó sobre pedido se (re)pide a Aldo en el POS
// DESPUÉS de guardar y sin deshacer: si el POS falla, las partidas ya quedaron
// confirmadas y bkoPosEstado / bkoPosError cuentan qué pasó.

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
    let pedido = await confirmarPartidas(id, validacion.datos, sesion.usuario);
    if (pedido.estatus === "confirmado") {
      try {
        pedido = await sincronizarBackorderPos(id, sesion.usuario);
      } catch (error) {
        console.error(`[mostrador] pidiendo a Aldo la back order del pedido ${id}:`, error);
      }
    }
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `confirmando partidas del pedido ${id}`);
  }
}
