import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarEstatus } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarCambioEstatus } from "@/lib/pedidos";

// El mostrador mueve el pedido: confirmado, listo, entregado o cancelado. La
// matriz de transiciones y el perfil del vendedor los impone la capa de datos
// (puedeCambiarEstatus); aquí solo se traduce: 403 si es cuestión de perfil,
// 409 si la transición no existe.

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
    const pedido = await cambiarEstatus(id, estatus, {
      usuario: sesion.usuario,
      perfil: sesion.perfil,
      canal: CANAL_MOSTRADOR,
      motivo,
      folioVentaPos,
    });
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando el estatus del pedido ${id} a ${estatus}`);
  }
}
