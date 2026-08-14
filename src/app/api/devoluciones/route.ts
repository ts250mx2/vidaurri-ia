import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
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

// La Bodega Usado no tiene tabla de devoluciones: cada devolución es un
// movimiento del kardex (bitacora_piezas con tipo_movimiento='DEVOLUCION').
interface FilaDevolucionUsada {
  id: number;
  fecha: string;
  folio: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  total: number;
  comentarios: string | null;
}

interface FilaResumenUsadas {
  devoluciones: number;
  importe: number;
  piezas: number;
}

interface FiltrosLista {
  fechaInicio: string;
  fechaFin: string;
  busqueda: string;
  page: number;
  pageSize: number;
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
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  // page/pageSize se interpolan en el LIMIT: se exigen enteros positivos
  // (default si no) y pageSize se acota al máximo.
  const pageBruto = Number(searchParams.get("page"));
  const pageSizeBruto = Number(searchParams.get("pageSize"));
  const filtros: FiltrosLista = {
    fechaInicio: ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
      ? searchParams.get("fechaInicio")!
      : diasAtrasISO(DIAS_RANGO_DEFAULT),
    fechaFin: ES_FECHA.test(searchParams.get("fechaFin") ?? "")
      ? searchParams.get("fechaFin")!
      : hoyISO(),
    busqueda: (searchParams.get("busqueda") ?? "").trim(),
    page: Number.isInteger(pageBruto) && pageBruto > 0 ? pageBruto : 1,
    pageSize:
      Number.isInteger(pageSizeBruto) && pageSizeBruto > 0
        ? Math.min(PAGE_SIZE_MAX, pageSizeBruto)
        : PAGE_SIZE_DEFAULT,
  };

  if (sucursal === "usadas") return listarDevolucionesUsadas(filtros);
  return listarDevolucionesMatriz(filtros);
}

/** Devoluciones de la MATRIZ (bdav): notas de salida con encabezado y detalle. */
async function listarDevolucionesMatriz(filtros: FiltrosLista) {
  const { fechaInicio, fechaFin, busqueda, page, pageSize } = filtros;

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
      sucursal: "matriz",
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

/** Devoluciones de la BODEGA USADO: movimientos del kardex, cada fila es una pieza. */
async function listarDevolucionesUsadas(filtros: FiltrosLista) {
  const { fechaInicio, fechaFin, busqueda, page, pageSize } = filtros;

  const condiciones: string[] = [
    "b.tipo_movimiento = 'DEVOLUCION'",
    "b.fecha_movimiento BETWEEN ? AND ?",
  ];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (busqueda) {
    // En el kardex no hay folio de nota: se busca por la pieza devuelta.
    // Casi todas las descripciones terminan en "<n> PUERTAS": se compara sin
    // ese sufijo para que buscar "puerta" no devuelva todo el almacén.
    condiciones.push(
      "(p.codigo LIKE ? OR REGEXP_REPLACE(p.descripcion, '[0-9]+ PUERTAS$', '') LIKE ?)"
    );
    params.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    // El POS de la Bodega no captura importes en devoluciones (precio y total
    // llegan en 0): se valúan con el precio de la pieza.
    const [filas, resumen] = await Promise.all([
      consultaUsadas<FilaDevolucionUsada>(
        `SELECT b.id_bitacora AS id, b.fecha_movimiento AS fecha,
                IFNULL(b.folio_movimiento, '') AS folio,
                p.codigo, p.descripcion,
                IFNULL(b.cantidad, 0) AS cantidad,
                IFNULL(NULLIF(b.precio, 0), IFNULL(p.precio, 0)) AS precio,
                IFNULL(NULLIF(b.total, 0), IFNULL(p.precio, 0) * IFNULL(b.cantidad, 0)) AS total,
                b.comentarios
           FROM bitacora_piezas b
           JOIN piezas p ON p.id_pieza = b.id_pieza
          WHERE ${where}
          ORDER BY b.fecha_movimiento DESC, b.id_bitacora DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      // Conteo y KPIs en una sola pasada: la base es remota.
      consultaUsadas<FilaResumenUsadas>(
        `SELECT COUNT(*)                   AS devoluciones,
                IFNULL(SUM(IFNULL(NULLIF(b.total, 0), IFNULL(p.precio, 0) * IFNULL(b.cantidad, 0))), 0) AS importe,
                IFNULL(SUM(b.cantidad), 0) AS piezas
           FROM bitacora_piezas b
           JOIN piezas p ON p.id_pieza = b.id_pieza
          WHERE ${where}`,
        params
      ),
    ]);

    const totalFiltro = resumen[0]?.devoluciones ?? 0;
    return NextResponse.json({
      sucursal: "usadas",
      fechaInicio,
      fechaFin,
      page,
      pageSize,
      total: totalFiltro,
      resumen: {
        devoluciones: totalFiltro,
        importe: resumen[0]?.importe ?? 0,
        piezas: resumen[0]?.piezas ?? 0,
      },
      devoluciones: filas,
    });
  } catch (error) {
    console.error("Error listando devoluciones de la Bodega Usado:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de la Bodega Usado" },
      { status: 502 }
    );
  }
}
