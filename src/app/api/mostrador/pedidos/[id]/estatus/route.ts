import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarEstatus, obtenerPedido } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarCambioEstatus } from "@/lib/pedidos";
import { cancelarBackorderPos, sincronizarBackorderPos } from "@/lib/pos-backorder";
import { cancelarCotizacionPos, sincronizarCotizacionPos } from "@/lib/pos-cotiza";

// El mostrador mueve el pedido: confirmado, listo, entregado o cancelado. La
// matriz de transiciones y el perfil del vendedor los impone la capa de datos
// (puedeCambiarEstatus); aquí solo se traduce: 403 si es cuestión de perfil,
// 409 si la transición no existe.
//
// Al quedar confirmado, las partidas sobre pedido se piden a Aldo como back
// order en el POS; al quedar listo, el pedido se refleja como cotización; al
// cancelarse, se cancelan las dos. Eso va DESPUÉS del cambio y nunca lo
// deshace: si el POS falla, el pedido ya cambió y el estado de su cotización
// (cotizaPosEstado / cotizaPosError) o de su back order (bkoPosEstado /
// bkoPosError) cuenta qué pasó, con reintento manual en POST .../cotizacion y
// POST .../backorder.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/** Lo que pasa DESPUÉS del cambio de estatus nunca lo deshace: si falla, se loguea y el pedido ya cambió. */
async function sinDeshacer(contexto: string, trabajo: () => Promise<void>): Promise<void> {
  try {
    await trabajo();
  } catch (error) {
    console.error(`[mostrador] ${contexto}:`, error);
  }
}

export async function POST(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCambioEstatus(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);
  const { estatus, motivo, folioVentaPos } = validacion.datos;

  try {
    let pedido = await cambiarEstatus(id, estatus, {
      usuario: sesion.usuario,
      perfil: sesion.perfil,
      canal: CANAL_MOSTRADOR,
      motivo,
      folioVentaPos,
    });
    if (estatus === "confirmado") {
      await sinDeshacer(`pidiendo a Aldo la back order del pedido ${id}`, async () => {
        pedido = await sincronizarBackorderPos(id, sesion.usuario);
      });
    } else if (estatus === "listo") {
      await sinDeshacer(`cotizando en el POS el pedido ${id}`, async () => {
        pedido = await sincronizarCotizacionPos(id, sesion.usuario);
      });
    } else if (estatus === "cancelado") {
      await sinDeshacer(`cancelando en el POS la cotización del pedido ${id}`, () =>
        cancelarCotizacionPos(id, sesion.usuario)
      );
      await sinDeshacer(`cancelando en el POS la back order del pedido ${id}`, () =>
        cancelarBackorderPos(id, sesion.usuario)
      );
      await sinDeshacer(`releyendo el pedido ${id} tras cancelarlo`, async () => {
        pedido = (await obtenerPedido(id)) ?? pedido;
      });
    }
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando el estatus del pedido ${id} a ${estatus}`);
  }
}
