import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo
const PAGE_MAX = 100000; // acota el OFFSET interpolado en LIMIT

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
  cliente: string | null;
  numCotiza: number | null;
  /** Solo en la Bodega Usado (la matriz no lo expone en el listado). */
  telefono?: string | null;
}

interface FilaResumen {
  ventas: number;
  importe: number;
  pagadas: number;
  vigentes: number;
  saldoPendiente: number;
}

interface Filtros {
  fechaInicio: string;
  fechaFin: string;
  serie: string;
  estatus: string;
  busqueda: string;
  page: number;
  pageSize: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function respuesta(f: Filtros, filas: FilaVenta[], total: number, resumen: FilaResumen | null) {
  return NextResponse.json({
    fechaInicio: f.fechaInicio,
    fechaFin: f.fechaFin,
    page: f.page,
    pageSize: f.pageSize,
    total,
    resumen,
    ventas: filas,
  });
}

async function listarMatriz(f: Filtros) {
  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["v.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [f.fechaInicio, f.fechaFin];
  if (f.serie === "V" || f.serie === "M") {
    condiciones.push("v.serie = ?");
    params.push(f.serie);
  }
  if (f.estatus === "VIGENTE" || f.estatus === "PAGADA") {
    condiciones.push("v.estatus = ?");
    params.push(f.estatus);
  }
  if (f.busqueda) {
    // Folio exacto o nombre de cliente (registrado o público general).
    condiciones.push("(v.num_venta = ? OR c.nombre LIKE ? OR v.nombre LIKE ?)");
    params.push(Number(f.busqueda) || 0, `%${f.busqueda}%`, `%${f.busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (f.page - 1) * f.pageSize;

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
          LIMIT ${offset}, ${f.pageSize}`,
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
                IFNULL(SUM(v.estatus = 'PAGADA'), 0)            AS pagadas,
                IFNULL(SUM(v.estatus = 'VIGENTE'), 0)           AS vigentes,
                IFNULL(SUM(IF(v.estatus = 'VIGENTE', v.saldo, 0)), 0) AS saldoPendiente
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE ${where}`,
        params
      ),
    ]);
    return respuesta(f, filas, conteo[0]?.total ?? 0, resumen[0] ?? null);
  } catch (error) {
    console.error("Error listando ventas:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las ventas" },
      { status: 502 }
    );
  }
}

async function listarUsadas(f: Filtros) {
  // La Bodega Usado no maneja serie ni id_cliente: el cliente va en texto libre
  // (NULL/vacío = público general) y el estatus es ACTIVO | PAGADO.
  const condiciones: string[] = ["v.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [f.fechaInicio, f.fechaFin];
  if (f.estatus === "ACTIVO" || f.estatus === "PAGADO") {
    condiciones.push("v.estatus = ?");
    params.push(f.estatus);
  }
  if (f.busqueda) {
    // Folio exacto (acepta "U-123" o "123") o nombre del cliente.
    const folio = Number(f.busqueda.replace(/^u-?\s*/i, "")) || 0;
    condiciones.push("(v.num_venta = ? OR v.nombre_cliente LIKE ?)");
    params.push(folio, `%${f.busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (f.page - 1) * f.pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaUsadas<FilaVenta>(
        `SELECT v.id_venta AS id, v.num_venta AS numVenta, NULL AS serie, v.fecha,
                IFNULL(v.subtotal, 0) AS subtotal, IFNULL(v.iva, 0) AS iva,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo,
                v.estatus, NULL AS numCotiza,
                NULLIF(v.nombre_cliente, '') AS cliente,
                v.telefono_cliente AS telefono
           FROM ventas v
          WHERE ${where}
          ORDER BY v.fecha DESC, v.id_venta DESC
          LIMIT ${offset}, ${f.pageSize}`,
        params
      ),
      consultaUsadas<{ total: number }>(
        `SELECT COUNT(*) AS total FROM ventas v WHERE ${where}`,
        params
      ),
      consultaUsadas<FilaResumen>(
        `SELECT COUNT(*)                                        AS ventas,
                IFNULL(SUM(v.total), 0)                         AS importe,
                IFNULL(SUM(v.estatus = 'PAGADO'), 0)            AS pagadas,
                IFNULL(SUM(v.estatus = 'ACTIVO'), 0)            AS vigentes,
                IFNULL(SUM(IF(v.estatus = 'ACTIVO', v.saldo, 0)), 0) AS saldoPendiente
           FROM ventas v
          WHERE ${where}`,
        params
      ),
    ]);
    return respuesta(f, filas, conteo[0]?.total ?? 0, resumen[0] ?? null);
  } catch (error) {
    console.error("Error listando ventas de la Bodega Usado:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de la Bodega Usado" },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const hoy = hoyISO();
  // page y pageSize se interpolan en LIMIT: deben ser enteros dentro de rango.
  const pagina = Number(searchParams.get("page"));
  const tamano = Number(searchParams.get("pageSize"));
  const filtros: Filtros = {
    fechaInicio: ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
      ? searchParams.get("fechaInicio")!
      : hoy,
    fechaFin: ES_FECHA.test(searchParams.get("fechaFin") ?? "")
      ? searchParams.get("fechaFin")!
      : hoy,
    serie: searchParams.get("serie") ?? "",
    estatus: searchParams.get("estatus") ?? "",
    busqueda: (searchParams.get("busqueda") ?? "").trim(),
    page: Number.isInteger(pagina) && pagina >= 1 ? Math.min(pagina, PAGE_MAX) : 1,
    pageSize:
      Number.isInteger(tamano) && tamano >= 1
        ? Math.min(tamano, PAGE_SIZE_MAX)
        : PAGE_SIZE_DEFAULT,
  };

  return sucursal === "usadas" ? listarUsadas(filtros) : listarMatriz(filtros);
}
