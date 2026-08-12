import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo
const DIAS_RANGO_DEFAULT = 30;

interface FilaDevolucion {
  id: number;
  numDevolucion: number;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  estatus: string | null;
}

interface FilaResumen {
  devoluciones: number;
  importe: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function diasAtrasISO(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toLocaleDateString("sv-SE");
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : diasAtrasISO(DIAS_RANGO_DEFAULT);
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoyISO();
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["d.fecha_devolucion BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (busqueda) {
    // Folio exacto de la nota de salida.
    condiciones.push("d.num_devolucion = ?");
    params.push(Number(busqueda) || 0);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen, piezas] = await Promise.all([
      consultaBdav<FilaDevolucion>(
        `SELECT d.id, d.num_devolucion AS numDevolucion, d.fecha_devolucion AS fecha,
                IFNULL(d.subtotal, 0) AS subtotal, IFNULL(d.iva, 0) AS iva,
                IFNULL(d.total, 0) AS total, d.estatus_devolucion AS estatus
           FROM devoluciones d
          WHERE ${where}
          ORDER BY d.fecha_devolucion DESC, d.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM devoluciones d
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                AS devoluciones,
                IFNULL(SUM(d.total), 0) AS importe
           FROM devoluciones d
          WHERE ${where}`,
        params
      ),
      // Piezas en consulta aparte: un JOIN al detalle duplicaría los encabezados.
      consultaBdav<{ piezas: number }>(
        `SELECT IFNULL(SUM(dd.cantidad), 0) AS piezas
           FROM devoluciones_detalle dd
           JOIN devoluciones d ON d.id = dd.id_devolucion
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
      resumen: {
        devoluciones: resumen[0]?.devoluciones ?? 0,
        importe: resumen[0]?.importe ?? 0,
        piezas: piezas[0]?.piezas ?? 0,
      },
      devoluciones: filas,
    });
  } catch (error) {
    console.error("Error listando devoluciones:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las devoluciones" },
      { status: 502 }
    );
  }
}
