import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultarSaldoAxon } from "@/lib/axon-creditos";
import { respuestaErrorAxon } from "@/lib/axon-http";

// Saldo de tokens de WhatsApp en Axon Logic. Cacheado 30 s en el servidor
// (lo pide Axon); ?forzar=1 lo salta, para la vuelta de un pago.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const forzar = new URL(request.url).searchParams.get("forzar") === "1";
  try {
    const saldo = await consultarSaldoAxon({ forzar });
    return NextResponse.json({ saldo });
  } catch (error) {
    return respuestaErrorAxon(error, "consultar el saldo");
  }
}
