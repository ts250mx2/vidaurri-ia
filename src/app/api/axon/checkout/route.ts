import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { iniciarCheckoutAxon, leerPackId } from "@/lib/axon-creditos";
import { respuestaErrorAxon } from "@/lib/axon-http";
import { baseUrlConfigurada } from "@/lib/url-publica";

// Compra de un pack de tokens: abre la sesión de pago en Stripe y devuelve la
// URL a la que la interfaz manda al usuario. Stripe lo regresa a
// /dashboard/axon?pago=ok|cancelado sobre PUBLIC_BASE_URL, que aquí es
// obligatoria: la dirección a la que vuelve alguien que acaba de pagar no se
// deduce de un encabezado Host que manda el cliente. Axon acredita los tokens
// al confirmarse el pago. Queda en el log quién inició cada compra.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const packId = leerPackId(await request.json().catch(() => null));
  if (!packId) return NextResponse.json({ error: "Elige un pack del catálogo" }, { status: 400 });

  const base = baseUrlConfigurada();
  if (!base) {
    return NextResponse.json(
      {
        error:
          "Falta PUBLIC_BASE_URL en el servidor: es la dirección a la que Stripe regresa después del pago",
      },
      { status: 500 }
    );
  }

  try {
    const checkout = await iniciarCheckoutAxon(packId, {
      exito: `${base}/dashboard/axon?pago=ok`,
      cancelado: `${base}/dashboard/axon?pago=cancelado`,
    });
    console.info(`Compra de tokens Axon iniciada por ${sesion.usuario}: ${packId}`);
    return NextResponse.json({ checkout });
  } catch (error) {
    return respuestaErrorAxon(error, "iniciar la compra");
  }
}
