import { leerIdRuta } from "@/lib/clientes-descuento";
import { obtenerPedido } from "@/lib/db-pedidos";
import { firmaCotizacionValida, firmaValida } from "@/lib/pedido-enlace";
import { generarPdfPedido } from "@/lib/pedido-pdf";

// PDF de un pedido para el cliente: lo abre desde la liga que el Vendedor IA
// le manda por WhatsApp al confirmar. Es público a propósito (el cliente no
// tiene sesión), pero solo abre con la firma HMAC del id (pedido-enlace.ts);
// sin ella, o con la de otro pedido, responde 404 sin decir si el pedido existe.
// Con `?c=<firma>` es la COTIZACIÓN que el mostrador mandó por WhatsApp: otra
// firma, abre también borradores y el PDF sale titulado como cotización.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

function noEncontrado(): Response {
  return new Response("No encontrado", { status: 404 });
}

export async function GET(request: Request, contexto: Contexto) {
  const id = leerIdRuta((await contexto.params).id);
  const { searchParams } = new URL(request.url);
  const firmaCotizacion = searchParams.get("c");
  const cotizacion = id !== null && firmaCotizacion !== null && firmaCotizacionValida(id, firmaCotizacion);
  const firma = searchParams.get("f") ?? "";
  if (id === null || (!cotizacion && !firmaValida(id, firma))) return noEncontrado();

  try {
    const pedido = await obtenerPedido(id);
    // Un borrador no tiene folio ni es un pedido todavía: no se comparte como
    // pedido; como cotización sí, que para eso es.
    if (!pedido || (!cotizacion && !pedido.folio)) return noEncontrado();
    const pdf = await generarPdfPedido(pedido, { cotizacion });
    const archivo = cotizacion ? `cotizacion-${pedido.folio ?? pedido.id}.pdf` : `${pedido.folio}.pdf`;
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${archivo}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error(`Error generando el PDF del pedido ${id}:`, error);
    return new Response("No se pudo generar el PDF", { status: 502 });
  }
}
