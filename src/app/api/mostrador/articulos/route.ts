import { buscarArticulosParaPedido, LIMITE_BUSQUEDA_ARTICULOS } from "@/lib/articulos-pedido";
import { exigirMostrador } from "@/lib/auth-mostrador";
import { leerIdRuta } from "@/lib/clientes-descuento";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Buscador manual de artículos de /mostrador/nuevo, con el precio que le toca
// al cliente elegido (o el de mostrador si no hay cliente). Solo lectura de bdav.
// `limite` (opcional) es cuántos renglones devolver; la librería lo acota.

export const dynamic = "force-dynamic";

const BUSQUEDA_MAX = 80;

/** `limite` del querystring: un entero positivo, o el default si no viene o no se entiende. */
function limiteDe(crudo: string | null): number {
  const n = Number.parseInt(crudo ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : LIMITE_BUSQUEDA_ARTICULOS;
}

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

    const articulos = await buscarArticulosParaPedido(busqueda, descuento, limiteDe(searchParams.get("limite")));
    return respuestaOk({ articulos });
  } catch (error) {
    return respuestaDeError(error, `buscando artículos para el pedido ("${busqueda}")`);
  }
}
