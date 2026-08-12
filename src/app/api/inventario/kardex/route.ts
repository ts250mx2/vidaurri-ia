import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo
const TIPOS_MOV = ["ENTRADA", "VENTA", "DEVOLUCION"];

interface FilaMovimiento {
  id: number;
  fecha: string;
  tipoMov: string;
  tipoDoc: string | null;
  numDoc: number | null;
  codigo: string;
  descripcion: string;
  existAnt: number;
  cantidad: number;
  existPost: number;
  usuario: string | null;
}

interface FilaResumen {
  movimientos: number;
  entradas: number;
  ventas: number;
  devoluciones: number;
  piezas: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const hoy = hoyISO();
  // mov_articulos tiene ~610k filas y fecha SIN índice: el rango de fechas se
  // exige siempre (default hoy) para acotar el escaneo, y el LIMIT se mantiene.
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : hoy;
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoy;
  const tipoMov = searchParams.get("tipoMov") ?? "";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["m.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (TIPOS_MOV.includes(tipoMov)) {
    condiciones.push("m.tipo_mov = ?");
    params.push(tipoMov);
  }
  if (busqueda) {
    // Código por prefijo (aprovecha índice) o descripción por contenido.
    condiciones.push("(a.codigo LIKE ? OR a.descripcion LIKE ?)");
    params.push(`${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaMovimiento>(
        `SELECT m.id, m.fecha, m.tipo_mov AS tipoMov, m.tipo_doc AS tipoDoc,
                m.num_doc AS numDoc, a.codigo, a.descripcion,
                IFNULL(m.exist_ant, 0) AS existAnt, IFNULL(m.cantidad, 0) AS cantidad,
                IFNULL(m.exist_post, 0) AS existPost, u.nombre AS usuario
           FROM mov_articulos m
           JOIN articulos a ON a.id = m.id_articulo
           LEFT JOIN usuarios u ON u.id = m.id_usuario
          WHERE ${where}
          ORDER BY m.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM mov_articulos m
           JOIN articulos a ON a.id = m.id_articulo
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                          AS movimientos,
                IFNULL(SUM(m.tipo_mov = 'ENTRADA'), 0)    AS entradas,
                IFNULL(SUM(m.tipo_mov = 'VENTA'), 0)      AS ventas,
                IFNULL(SUM(m.tipo_mov = 'DEVOLUCION'), 0) AS devoluciones,
                IFNULL(SUM(m.cantidad), 0)                AS piezas
           FROM mov_articulos m
           JOIN articulos a ON a.id = m.id_articulo
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
      movimientos: filas,
    });
  } catch (error) {
    console.error("Error listando kardex:", error);
    return NextResponse.json(
      { error: "No fue posible consultar el kardex" },
      { status: 502 }
    );
  }
}
