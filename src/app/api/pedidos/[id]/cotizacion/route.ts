import { leerIdRuta } from "@/lib/clientes-descuento";
import { vistaCotizacion } from "@/lib/cotizacion-aceptacion";
import { obtenerPedido } from "@/lib/db-pedidos";
import { firmaCotizacionValida } from "@/lib/pedido-enlace";

// GET /api/pedidos/[id]/cotizacion?c=<firma>: la cotización como la ve el
// cliente en la página pública (`/cotizacion/[id]`), para revisarla y
// firmarla. Pública a propósito, pero solo abre con la firma HMAC de la
// cotización (pedido-enlace.ts); sin ella responde 404 sin decir si existe.
// Devuelve solo la vista recortada (cotizacion-aceptacion.ts): nada del
// padrón, del POS ni de la bitácora.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(request: Request, contexto: Contexto) {
  const id = leerIdRuta((await contexto.params).id);
  const firma = new URL(request.url).searchParams.get("c") ?? "";
  if (id === null || !firmaCotizacionValida(id, firma)) {
    return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }
  try {
    const pedido = await obtenerPedido(id);
    if (!pedido) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
    return Response.json({ ok: true, cotizacion: vistaCotizacion(pedido) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(`Error leyendo la cotización ${id} para la página:`, error);
    return Response.json({ ok: false, error: "No se pudo leer la cotización" }, { status: 502 });
  }
}
