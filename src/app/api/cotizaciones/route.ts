import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo

interface FilaCotizacion {
  id: number;
  numCotiza: number;
  fecha: string;
  cliente: string | null;
  telefono: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estatus: string | null;
  observa: string | null;
}

interface FilaResumen {
  cotizaciones: number;
  importe: number;
  vigentes: number;
  convertidas: number;
  porcentajeConversion: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const hoy = hoyISO();
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : hoy;
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoy;
  const estatus = searchParams.get("estatus") ?? "";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["co.fecha_cot BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (estatus === "VIGENTE" || estatus === "VENTA" || estatus === "CANCELADA") {
    condiciones.push("co.estatus = ?");
    params.push(estatus);
  }
  if (busqueda) {
    // Folio exacto o nombre del cliente (capturado libre o del catálogo).
    condiciones.push("(co.num_cotiza = ? OR co.nombre LIKE ? OR c.nombre LIKE ?)");
    params.push(Number(busqueda) || 0, `%${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaCotizacion>(
        `SELECT co.id, co.num_cotiza AS numCotiza, co.fecha_cot AS fecha,
                IFNULL(NULLIF(co.nombre, ''), c.nombre) AS cliente,
                co.telefono, IFNULL(co.subtotal, 0) AS subtotal,
                IFNULL(co.iva, 0) AS iva, IFNULL(co.total, 0) AS total,
                co.estatus, co.observa
           FROM cotiza co
           LEFT JOIN clientes c ON c.id = co.id_cte
          WHERE ${where}
          ORDER BY co.fecha_cot DESC, co.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM cotiza co
           LEFT JOIN clientes c ON c.id = co.id_cte
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        // NULLIF evita la división entre cero cuando el rango no tiene cotizaciones.
        `SELECT COUNT(*)                                  AS cotizaciones,
                IFNULL(SUM(co.total), 0)                  AS importe,
                IFNULL(SUM(co.estatus = 'VIGENTE'), 0)    AS vigentes,
                IFNULL(SUM(co.estatus = 'VENTA'), 0)      AS convertidas,
                IFNULL(ROUND(SUM(co.estatus = 'VENTA') / NULLIF(COUNT(*), 0) * 100, 1), 0)
                                                          AS porcentajeConversion
           FROM cotiza co
           LEFT JOIN clientes c ON c.id = co.id_cte
          WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      fechaInicio,
      fechaFin,
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      cotizaciones: filas,
    });
  } catch (error) {
    console.error("Error listando cotizaciones:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las cotizaciones" },
      { status: 502 }
    );
  }
}
