import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { listarConversaciones } from "@/lib/db-conversaciones";

// Listado de la bitácora de conversaciones del Vendedor IA. Solo con sesión
// del panel: aquí hay teléfonos reales de clientes y lo que escribieron.

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;
const PAGINA_MAX = 10000;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return new Response("No autorizado", { status: 401 });

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde") ?? "";
  const hasta = searchParams.get("hasta") ?? "";
  if (!ES_FECHA.test(desde) || !ES_FECHA.test(hasta)) {
    return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
  }

  const canalCrudo = searchParams.get("canal");
  const canal =
    canalCrudo === "whatsapp" || canalCrudo === "web" || canalCrudo === "mostrador"
      ? canalCrudo
      : undefined;

  // El teléfono de búsqueda se reduce a dígitos aquí Y en la capa de datos:
  // la validación de frontera no sustituye a la del que arma el SQL.
  const telefono = (searchParams.get("telefono") ?? "").replace(/\D/g, "").slice(0, 20);
  // Texto libre: teléfono o nombre del cliente; la capa de datos decide cuál.
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, 80);

  // Un contacto exacto, con la clave que da /api/conversaciones/contactos:
  // 'c<id>' = cliente del padrón (todos sus celulares), 't<telefono>' = un número.
  const contacto = searchParams.get("contacto") ?? "";
  const idCliente = /^c\d{1,15}$/.test(contacto) ? Number(contacto.slice(1)) : undefined;
  const telefonoExacto = /^t\+?\d{1,20}$/.test(contacto) ? contacto.slice(1) : undefined;
  if (contacto && idCliente === undefined && telefonoExacto === undefined) {
    return NextResponse.json({ error: "Contacto inválido" }, { status: 400 });
  }

  const pagina = Math.min(
    PAGINA_MAX,
    Math.max(1, Number.parseInt(searchParams.get("pagina") ?? "1", 10) || 1)
  );

  try {
    const datos = await listarConversaciones({
      desde,
      hasta,
      telefono: telefono || undefined,
      busqueda: busqueda || undefined,
      idCliente,
      telefonoExacto,
      canal,
      pagina,
      porPagina: POR_PAGINA,
    });
    return NextResponse.json({ ...datos, porPagina: POR_PAGINA });
  } catch (error) {
    console.error("Error listando conversaciones:", error);
    return NextResponse.json(
      { error: "No se pudo consultar la bitácora de conversaciones" },
      { status: 502 }
    );
  }
}
