import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
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

interface FilaMovimientoUsadas {
  id: number;
  fecha: string;
  tipoMov: string;
  numDoc: string | null;
  codigo: string;
  descripcion: string;
  existAnt: number;
  cantidad: number;
  existPost: number;
  precio: number;
  total: number;
}

interface FilaResumen {
  movimientos: number;
  entradas: number;
  ventas: number;
  devoluciones: number;
  piezas: number;
}

interface FiltrosKardex {
  fechaInicio: string;
  fechaFin: string;
  tipoMov: string;
  busqueda: string;
  pageSize: number;
  offset: number;
}

interface RespuestaKardex {
  total: number;
  resumen: FilaResumen | null;
  movimientos: FilaMovimiento[] | FilaMovimientoUsadas[];
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Kardex de la MATRIZ (bdav): mov_articulos + articulos. */
async function kardexMatriz(f: FiltrosKardex): Promise<RespuestaKardex> {
  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["m.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [f.fechaInicio, f.fechaFin];
  if (TIPOS_MOV.includes(f.tipoMov)) {
    condiciones.push("m.tipo_mov = ?");
    params.push(f.tipoMov);
  }
  if (f.busqueda) {
    // Código por prefijo (aprovecha índice) o descripción por contenido.
    condiciones.push("(a.codigo LIKE ? OR a.descripcion LIKE ?)");
    params.push(`${f.busqueda}%`, `%${f.busqueda}%`);
  }
  const where = condiciones.join(" AND ");

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
        LIMIT ${f.offset}, ${f.pageSize}`,
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

  return { total: conteo[0]?.total ?? 0, resumen: resumen[0] ?? null, movimientos: filas };
}

/** Kardex de la BODEGA USADO: bitacora_piezas + piezas (base remota). */
async function kardexUsadas(f: FiltrosKardex): Promise<RespuestaKardex> {
  // bitacora_piezas tiene ~21k filas en un servidor remoto compartido: igual
  // que en matriz, el rango de fechas se exige siempre y el LIMIT se mantiene.
  const condiciones: string[] = ["b.fecha_movimiento BETWEEN ? AND ?"];
  const params: unknown[] = [f.fechaInicio, f.fechaFin];
  if (TIPOS_MOV.includes(f.tipoMov)) {
    condiciones.push("b.tipo_movimiento = ?");
    params.push(f.tipoMov);
  }
  if (f.busqueda) {
    // Casi todas las descripciones terminan en "<n> PUERTAS": se compara sin
    // ese sufijo para que buscar "puerta" no devuelva todo el almacén.
    condiciones.push(
      "(p.codigo LIKE ? OR REGEXP_REPLACE(p.descripcion, '[0-9]+ PUERTAS$', '') LIKE ?)"
    );
    params.push(`${f.busqueda}%`, `%${f.busqueda}%`);
  }
  const where = condiciones.join(" AND ");

  const [filas, conteo, resumen] = await Promise.all([
    consultaUsadas<FilaMovimientoUsadas>(
      `SELECT b.id_bitacora AS id, b.fecha_movimiento AS fecha,
              b.tipo_movimiento AS tipoMov, b.folio_movimiento AS numDoc,
              p.codigo, p.descripcion,
              IFNULL(b.existencia_anterior, 0) AS existAnt,
              IFNULL(b.cantidad, 0) AS cantidad,
              IFNULL(b.existencia_posterior, 0) AS existPost,
              IFNULL(b.precio, 0) AS precio, IFNULL(b.total, 0) AS total
         FROM bitacora_piezas b
         JOIN piezas p ON p.id_pieza = b.id_pieza
        WHERE ${where}
        ORDER BY b.id_bitacora DESC
        LIMIT ${f.offset}, ${f.pageSize}`,
      params
    ),
    consultaUsadas<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM bitacora_piezas b
         JOIN piezas p ON p.id_pieza = b.id_pieza
        WHERE ${where}`,
      params
    ),
    consultaUsadas<FilaResumen>(
      `SELECT COUNT(*)                                         AS movimientos,
              IFNULL(SUM(b.tipo_movimiento = 'ENTRADA'), 0)    AS entradas,
              IFNULL(SUM(b.tipo_movimiento = 'VENTA'), 0)      AS ventas,
              IFNULL(SUM(b.tipo_movimiento = 'DEVOLUCION'), 0) AS devoluciones,
              IFNULL(SUM(b.cantidad), 0)                       AS piezas
         FROM bitacora_piezas b
         JOIN piezas p ON p.id_pieza = b.id_pieza
        WHERE ${where}`,
      params
    ),
  ]);

  return { total: conteo[0]?.total ?? 0, resumen: resumen[0] ?? null, movimientos: filas };
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const hoy = hoyISO();
  // Ambas tablas de kardex son grandes (mov_articulos ~610k, bitacora_piezas
  // ~21k remota): el rango de fechas se exige siempre (default hoy) para acotar
  // el escaneo, y el LIMIT se mantiene.
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : hoy;
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoy;
  const tipoMov = searchParams.get("tipoMov") ?? "";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  // page/pageSize se interpolan en el LIMIT: se exigen enteros positivos
  // (default si no) y pageSize se acota al máximo.
  const pageBruto = Number(searchParams.get("page"));
  const page = Number.isInteger(pageBruto) && pageBruto > 0 ? pageBruto : 1;
  const pageSizeBruto = Number(searchParams.get("pageSize"));
  const pageSize =
    Number.isInteger(pageSizeBruto) && pageSizeBruto > 0
      ? Math.min(PAGE_SIZE_MAX, pageSizeBruto)
      : PAGE_SIZE_DEFAULT;

  const filtros: FiltrosKardex = {
    fechaInicio,
    fechaFin,
    tipoMov,
    busqueda,
    pageSize,
    offset: (page - 1) * pageSize,
  };

  try {
    const datos = sucursal === "usadas" ? await kardexUsadas(filtros) : await kardexMatriz(filtros);

    return NextResponse.json({
      sucursal,
      fechaInicio,
      fechaFin,
      page,
      pageSize,
      total: datos.total,
      resumen: datos.resumen,
      movimientos: datos.movimientos,
    });
  } catch (error) {
    console.error(`Error listando kardex (${sucursal}):`, error);
    const mensaje =
      sucursal === "usadas"
        ? "No fue posible consultar la base de la Bodega Usado"
        : "No fue posible consultar el kardex";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
