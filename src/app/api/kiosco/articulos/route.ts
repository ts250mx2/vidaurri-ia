import { buscarArticulosParaPedido } from "@/lib/articulos-pedido";
import { exigirKiosco } from "@/lib/auth-kiosco";
import { AREA_KIOSCO, articuloParaKiosco } from "@/lib/kiosco-api";
import { respuestaDeError, respuestaOk } from "@/lib/mostrador-api";

// Buscador del kiosco de autoservicio: el cliente teclea lo que busca y ve
// precio de MOSTRADOR con IVA (descuento null: en el piso no hay padrón) y si
// la pieza está en tienda o va sobre pedido. Solo lectura de bdav, y lo que
// sale está recortado por articuloParaKiosco: nunca existencia exacta, costo
// ni localización, porque esta pantalla la lee cualquiera que pase.

export const dynamic = "force-dynamic";

const BUSQUEDA_MAX = 80;

export async function GET(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);
  if (!busqueda) return respuestaOk({ articulos: [] });

  try {
    const articulos = await buscarArticulosParaPedido(busqueda, null);
    return respuestaOk({ articulos: articulos.map(articuloParaKiosco) });
  } catch (error) {
    return respuestaDeError(error, `buscando artículos en el kiosco ("${busqueda}")`, AREA_KIOSCO);
  }
}
