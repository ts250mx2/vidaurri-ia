import { leerIdRuta } from "@/lib/clientes-descuento";
import { validarAceptacion, vistaCotizacion } from "@/lib/cotizacion-aceptacion";
import { aceptarCotizacion, PedidoVacioError, TransicionInvalidaError } from "@/lib/db-pedidos";
import { firmaCotizacionValida } from "@/lib/pedido-enlace";

// POST /api/pedidos/[id]/aceptar?c=<firma> `{ nombre, firma }`: el cliente
// firmó la cotización en la página pública; se guarda la firma y el borrador
// se envía (recibe folio, entra a la cola del mostrador). Misma firma HMAC
// de la cotización que el GET; sin ella, 404. Una cotización ya aceptada (o
// cancelada) responde 409 con la vista, para que la página enseñe el folio en
// vez de un error.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };
const CUERPO_MAX = 260_000;

export async function POST(request: Request, contexto: Contexto) {
  const id = leerIdRuta((await contexto.params).id);
  const firma = new URL(request.url).searchParams.get("c") ?? "";
  if (id === null || !firmaCotizacionValida(id, firma)) {
    return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  let cuerpo: unknown;
  try {
    const texto = await request.text();
    if (texto.length > CUERPO_MAX) return Response.json({ ok: false, error: "La firma es demasiado grande" }, { status: 413 });
    cuerpo = JSON.parse(texto);
  } catch {
    return Response.json({ ok: false, error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarAceptacion(cuerpo);
  if (!validacion.ok) return Response.json({ ok: false, error: validacion.error }, { status: 400 });

  try {
    const pedido = await aceptarCotizacion(id, validacion.datos);
    return Response.json({ ok: true, cotizacion: vistaCotizacion(pedido) });
  } catch (error) {
    if (error instanceof TransicionInvalidaError) {
      return Response.json({ ok: false, error: "Esta cotización ya se aceptó o ya no está abierta" }, { status: 409 });
    }
    if (error instanceof PedidoVacioError) {
      return Response.json({ ok: false, error: "La cotización no tiene piezas" }, { status: 409 });
    }
    console.error(`Error aceptando la cotización ${id}:`, error);
    return Response.json({ ok: false, error: "No se pudo registrar la aceptación; inténtalo de nuevo" }, { status: 502 });
  }
}
