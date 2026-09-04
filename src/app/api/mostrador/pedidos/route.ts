import { exigirMostrador } from "@/lib/auth-mostrador";
import { listarPedidos } from "@/lib/db-pedidos";
import { respuestaDeError, respuestaOk } from "@/lib/mostrador-api";
import { validarFiltrosPedidos } from "@/lib/pedidos";

// Cola de pedidos del mostrador (vidaurri-page). Los filtros vienen en el
// querystring y se normalizan sin fallar: lo que no se entiende se ignora.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  const { searchParams } = new URL(request.url);
  const filtros = validarFiltrosPedidos(Object.fromEntries(searchParams));

  try {
    const pagina = await listarPedidos(filtros);
    // El tamaño efectivo (por si la página pidió "todos" o un número fuera de rango).
    return respuestaOk({ ...pagina, porPagina: filtros.porPagina });
  } catch (error) {
    return respuestaDeError(error, "listando la cola de pedidos");
  }
}
