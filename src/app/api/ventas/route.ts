import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo

interface FilaVenta {
  id: number;
  numVenta: number;
  serie: string | null;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  saldo: number;
  estatus: string | null;
  cliente: string;
  numCotiza: number | null;
}

interface FilaResumen {
  ventas: number;
  importe: number;
  pagadas: number;
  vigentes: number;
  saldoPendiente: number;
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
  const serie = searchParams.get("serie") ?? "";
  const estatus = searchParams.get("estatus") ?? "";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["v.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (serie === "V" || serie === "M") {
    condiciones.push("v.serie = ?");
    params.push(serie);
  }
  if (estatus === "VIGENTE" || estatus === "PAGADA") {
    condiciones.push("v.estatus = ?");
    params.push(estatus);
  }
  if (busqueda) {
    // Folio exacto o nombre de cliente (registrado o público general).
    condiciones.push(
      "(v.num_venta = ? OR c.nombre LIKE ? OR v.nombre LIKE ?)"
    );
    params.push(Number(busqueda) || 0, `%${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaVenta>(
        `SELECT v.id, v.num_venta AS numVenta, v.serie, v.fecha,
                IFNULL(v.subtotal, 0) AS subtotal, IFNULL(v.iva, 0) AS iva,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo,
                v.estatus, v.num_cotiza AS numCotiza,
                IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE ${where}
          ORDER BY v.fecha DESC, v.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                                        AS ventas,
                IFNULL(SUM(v.total), 0)                         AS importe,
                SUM(v.estatus = 'PAGADA')                       AS pagadas,
                SUM(v.estatus = 'VIGENTE')                      AS vigentes,
                IFNULL(SUM(IF(v.estatus = 'VIGENTE', v.saldo, 0)), 0) AS saldoPendiente
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
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
      ventas: filas,
    });
  } catch (error) {
    console.error("Error listando ventas:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las ventas" },
      { status: 502 }
    );
  }
}
