import { buscarArticulosParaPedido } from "@/lib/articulos-pedido";
import { exigirMostrador } from "@/lib/auth-mostrador";
import { leerIdRuta } from "@/lib/clientes-descuento";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Buscador manual de artículos de /mostrador/nuevo, con el precio que le toca
// al cliente elegido (o el de mostrador si no hay cliente). Solo lectura de bdav.

export const dynamic = "force-dynamic";

const BUSQUEDA_MAX = 80;

/** Descuento del cliente del querystring: null = mostrador; undefined = id inválido o inexistente. */
async function descuentoDeCliente(idCrudo: string | null): Promise<number | null | undefined> {
  if (idCrudo === null || idCrudo.trim() === "") return null;
  const id = leerIdRuta(idCrudo.trim());
  if (id === null) return undefined;
  const cliente = await obtenerClienteDescuento(id);
  return cliente ? cliente.descuento : undefined;
}

export async function GET(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);
  if (!busqueda) return respuestaOk({ articulos: [] });

  try {
    const descuento = await descuentoDeCliente(searchParams.get("idCliente"));
    if (descuento === undefined) return respuestaError("El cliente no está en el padrón", 404);

    const articulos = await buscarArticulosParaPedido(busqueda, descuento);
    return respuestaOk({ articulos });
  } catch (error) {
    return respuestaDeError(error, `buscando artículos para el pedido ("${busqueda}")`);
  }
}
