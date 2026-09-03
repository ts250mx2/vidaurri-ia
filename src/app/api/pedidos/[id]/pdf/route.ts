import { leerIdRuta } from "@/lib/clientes-descuento";
import { obtenerPedido } from "@/lib/db-pedidos";
import { firmaValida } from "@/lib/pedido-enlace";
import { generarPdfPedido } from "@/lib/pedido-pdf";

// PDF de un pedido para el cliente: lo abre desde la liga que el Vendedor IA
// le manda por WhatsApp al confirmar. Es público a propósito (el cliente no
// tiene sesión), pero solo abre con la firma HMAC del id (pedido-enlace.ts);
// sin ella, o con la de otro pedido, responde 404 sin decir si el pedido existe.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

function noEncontrado(): Response {
  return new Response("No encontrado", { status: 404 });
}

export async function GET(request: Request, contexto: Contexto) {
  const id = leerIdRuta((await contexto.params).id);
  const firma = new URL(request.url).searchParams.get("f") ?? "";
  if (id === null || !firmaValida(id, firma)) return noEncontrado();

  try {
    const pedido = await obtenerPedido(id);
    // Un borrador no tiene folio ni es un pedido todavía: no se comparte.
    if (!pedido || !pedido.folio) return noEncontrado();
    const pdf = await generarPdfPedido(pedido);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pedido.folio}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error(`Error generando el PDF del pedido ${id}:`, error);
    return new Response("No se pudo generar el PDF", { status: 502 });
  }
}
