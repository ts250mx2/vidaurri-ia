import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar la vista completa

// Piezas vendidas por artículo en los últimos 90 días (corte fijo del reporte).
const VENTAS_90_DIAS = `SELECT d.id_articulo, SUM(d.cantidad) AS piezas90
             FROM detalle_venta d
             JOIN ventas v ON v.id = d.id_venta
            WHERE v.fecha >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
            GROUP BY d.id_articulo`;

interface FilaQuiebre {
  id: number;
  codigo: string;
  descripcion: string | null;
  linea: string | null;
  existencia: number;
  piezas90: number;
  precioLista: number;
  minimo: number | null;
  reorden: number | null;
  maximo: number | null;
  localizacion: string | null;
}

interface FilaResumen {
  codigos: number;
  piezas90: number;
  valorRecompra: number;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get("tipo") === "reorden" ? "reorden" : "quiebres";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  const esQuiebre = tipo === "quiebres";
  // Quiebres: el JOIN exige venta reciente (sin existencia pero SÍ se vende).
  // Bajo reorden: LEFT JOIN, un artículo puede estar bajo reorden sin venta reciente.
  const joinVentas = esQuiebre
    ? `JOIN (${VENTAS_90_DIAS}) s ON s.id_articulo = a.id`
    : `LEFT JOIN (${VENTAS_90_DIAS}) s ON s.id_articulo = a.id`;
  const condiciones: string[] = [
    esQuiebre
      ? "a.existencia <= 0"
      : "a.existencia > 0 AND a.reorden IS NOT NULL AND a.reorden > 0 AND a.existencia <= a.reorden",
  ];
  const params: unknown[] = [];
  if (busqueda) {
    // Código por prefijo (aprovecha índice) o descripción en cualquier posición.
    condiciones.push("(a.codigo LIKE ? OR a.descripcion LIKE ?)");
    params.push(`${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  // Quiebres: lo más vendido primero; reorden: lo más cercano a agotarse primero.
  const orden = esQuiebre
    ? "piezas90 DESC, a.codigo"
    : "(a.existencia / a.reorden) ASC, piezas90 DESC";
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaQuiebre>(
        `SELECT a.id, a.codigo, a.descripcion, l.linea,
                IFNULL(a.existencia, 0) AS existencia,
                IFNULL(s.piezas90, 0) AS piezas90,
                IFNULL(a.precio_lista, 0) AS precioLista,
                a.minimo, a.reorden, a.maximo, a.localizacion
           FROM articulos a
           JOIN lineas l ON l.id = a.id_linea
           ${joinVentas}
          WHERE ${where}
          ORDER BY ${orden}
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM articulos a
           JOIN lineas l ON l.id = a.id_linea
           ${joinVentas}
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        // Recompra estimada: reponer hasta el máximo; sin máximo se asume 1 pieza.
        `SELECT COUNT(*)               AS codigos,
                IFNULL(SUM(s.piezas90), 0) AS piezas90,
                IFNULL(SUM(IFNULL(a.precio_cpa, 0) *
                           GREATEST(IFNULL(a.maximo, 0) - a.existencia, 1)), 0) AS valorRecompra
           FROM articulos a
           JOIN lineas l ON l.id = a.id_linea
           ${joinVentas}
          WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      tipo,
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      articulos: filas,
    });
  } catch (error) {
    console.error(`Error listando inventario (${tipo}):`, error);
    return NextResponse.json(
      { error: "No fue posible consultar los quiebres de inventario" },
      { status: 502 }
    );
  }
}
