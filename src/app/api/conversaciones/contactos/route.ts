import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { listarContactos } from "@/lib/db-conversaciones";

// Conversaciones de WhatsApp del Vendedor IA agrupadas por contacto: el
// cliente del padrón (con todos sus celulares) o, si no está dado de alta, el
// teléfono. Solo con sesión del panel: son teléfonos y nombres reales.

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;
const PAGINA_MAX = 10000;
const BUSQUEDA_MAX = 80;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde") ?? "";
  const hasta = searchParams.get("hasta") ?? "";
  if (!ES_FECHA.test(desde) || !ES_FECHA.test(hasta)) {
    return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
  }
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);
  const pagina = Math.min(
    PAGINA_MAX,
    Math.max(1, Number.parseInt(searchParams.get("pagina") ?? "1", 10) || 1)
  );

  try {
    const datos = await listarContactos({
      desde,
      hasta,
      busqueda: busqueda || undefined,
      pagina,
      porPagina: POR_PAGINA,
    });
    return NextResponse.json({ ...datos, porPagina: POR_PAGINA });
  } catch (error) {
    console.error("Error listando contactos de la bitácora:", error);
    return NextResponse.json(
      { error: "No se pudo consultar la bitácora de conversaciones" },
      { status: 502 }
    );
  }
}
