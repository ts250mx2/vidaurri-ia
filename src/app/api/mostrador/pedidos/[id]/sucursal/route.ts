import { exigirMostrador } from "@/lib/auth-mostrador";
import { cambiarSucursal } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarSucursal } from "@/lib/pedidos";

// Dónde recoge el cliente. Se cambia mientras el pedido se pueda editar
// (borrador, enviado o confirmado); ya listo, la pieza está en esa sucursal y
// la capa de datos contesta 409.

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
  const validacion = validarSucursal(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const pedido = await cambiarSucursal(id, validacion.datos.sucursal, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, `cambiando la sucursal del pedido ${id}`);
  }
}
