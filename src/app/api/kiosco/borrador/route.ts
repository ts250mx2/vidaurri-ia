import { exigirKiosco } from "@/lib/auth-kiosco";
import { cancelarBorrador, obtenerBorrador } from "@/lib/db-pedidos";
import { AREA_KIOSCO, CANAL_KIOSCO, actorCapturaKiosco, pedidoParaKiosco } from "@/lib/kiosco-api";
import { respuestaDeError, respuestaOk } from "@/lib/mostrador-api";

// El pedido en curso del APARATO (clave k:<kiosco>), que es lo que la pantalla
// pinta a la derecha. GET lo lee; DELETE lo limpia cuando el cliente termina o
// cuando la pantalla se cansa de esperarlo (inactividad): el siguiente que
// llegue no tiene por qué encontrarse el pedido del anterior.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;

  try {
    const borrador = await obtenerBorrador(actorCapturaKiosco(guardia.kiosco));
    return respuestaOk({ pedido: pedidoParaKiosco(borrador) });
  } catch (error) {
    return respuestaDeError(error, "leyendo el pedido del kiosco", AREA_KIOSCO);
  }
}

export async function DELETE(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;

  try {
    // Idempotente: si no había pedido en curso el resultado es el mismo.
    await cancelarBorrador(actorCapturaKiosco(guardia.kiosco), CANAL_KIOSCO, "Pedido descartado en el kiosco");
    return respuestaOk({ pedido: null });
  } catch (error) {
    return respuestaDeError(error, "limpiando el pedido del kiosco", AREA_KIOSCO);
  }
}
