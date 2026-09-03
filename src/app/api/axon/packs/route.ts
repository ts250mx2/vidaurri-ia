import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { listarPacksAxon } from "@/lib/axon-creditos";
import { respuestaErrorAxon } from "@/lib/axon-http";

// Catálogo de packs de tokens con precios vigentes (cacheado 10 min).

export const dynamic = "force-dynamic";

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const catalogo = await listarPacksAxon();
    return NextResponse.json({ catalogo });
  } catch (error) {
    return respuestaErrorAxon(error, "consultar los packs");
  }
}
