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
import { cancelarCotizacionPos, sincronizarCotizacionPos } from "@/lib/pos-cotiza";

// El mostrador mueve el pedido: confirmado, listo, entregado o cancelado. La
// matriz de transiciones y el perfil del vendedor los impone la capa de datos
// (puedeCambiarEstatus); aquí solo se traduce: 403 si es cuestión de perfil,
// 409 si la transición no existe.
//
// Al quedar listo, el pedido se refleja como cotización en el POS (y al
// cancelarse, la cotización se cancela). Eso va DESPUÉS del cambio y nunca lo
// deshace: si el POS falla, el pedido ya cambió y el estado de su cotización
// (cotizaPosEstado / cotizaPosError) cuenta qué pasó, con reintento manual en
// POST .../cotizacion.

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
    if (estatus === "listo") {
      try {
        pedido = await sincronizarCotizacionPos(id, sesion.usuario);
      } catch (error) {
        console.error(`[mostrador] cotizando en el POS el pedido ${id}:`, error);
      }
    } else if (estatus === "cancelado") {
      try {
        await cancelarCotizacionPos(id, sesion.usuario);
        pedido = (await obtenerPedido(id)) ?? pedido;
      } catch (error) {
        console.error(`[mostrador] cancelando en el POS la cotización del pedido ${id}:`, error);
      }
    }
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando el estatus del pedido ${id} a ${estatus}`);
  }
}
