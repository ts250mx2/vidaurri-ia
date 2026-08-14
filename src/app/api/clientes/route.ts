import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el padrón completo
const PAGE_MAX = 100000; // acota el OFFSET interpolado en LIMIT

interface FilaCliente {
  id: number;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  ciudad: string | null;
  estado: string | null;
  descuento: number;
  limiteCredito: number;
  saldo: number;
  activo: number;
  bloqueado: number;
}

interface FilaResumen {
  clientes: number;
  conSaldo: number;
  cartera: number;
  descuentoPromedio: number;
}

// Bodega Usado: no hay catálogo de clientes; se derivan de las ventas
// agrupando por nombre y teléfono (nombre vacío = público general).
interface FilaClienteUsado {
  nombre: string;
  telefono: string | null;
  compras: number;
  importe: number;
  saldo: number;
  ultimaCompra: string;
}

interface FilaResumenUsadas {
  clientes: number;
  compras: number;
  importe: number;
  saldo: number;
}

interface FilaPublicoGeneral {
  ventas: number;
  importe: number;
}

interface Filtros {
  busqueda: string;
  conSaldo: boolean;
  incluirInactivos: boolean;
  page: number;
  pageSize: number;
}

async function listarMatriz(f: Filtros) {
  // Filtros dinámicos, siempre parametrizados.
  // Los bit(1) llegan como Buffer con mysql2: (campo + 0) los convierte a 0/1.
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (!f.incluirInactivos) {
    condiciones.push("(c.activo + 0) = 1");
  }
  if (f.conSaldo) {
    condiciones.push("c.saldo > 0");
  }
  if (f.busqueda) {
    // RFC con prefijo (aprovecha índice); nombre y teléfono con LIKE amplio.
    condiciones.push("(c.nombre LIKE ? OR c.rfc LIKE ? OR c.telefono LIKE ?)");
    params.push(`%${f.busqueda}%`, `${f.busqueda}%`, `%${f.busqueda}%`);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const offset = (f.page - 1) * f.pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaCliente>(
        `SELECT c.id, c.nombre, c.rfc, c.telefono, c.ciudad, c.estado,
                IFNULL(c.descuento, 0) AS descuento,
                IFNULL(c.limite_credito, 0) AS limiteCredito,
                IFNULL(c.saldo, 0) AS saldo,
                (c.activo + 0) AS activo,
                (c.bloqueo_por_adeudo + 0) AS bloqueado
           FROM clientes c
          ${where}
          ORDER BY c.saldo DESC, c.nombre ASC
          LIMIT ${offset}, ${f.pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM clientes c
          ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                          AS clientes,
                IFNULL(SUM(c.saldo > 0), 0)       AS conSaldo,
                IFNULL(SUM(c.saldo), 0)           AS cartera,
                IFNULL(AVG(c.descuento), 0)       AS descuentoPromedio
           FROM clientes c
          ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      page: f.page,
      pageSize: f.pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      clientes: filas,
    });
  } catch (error) {
    console.error("Error listando clientes:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los clientes" },
      { status: 502 }
    );
  }
}

async function listarUsadas(f: Filtros) {
  // La Bodega Usado no tiene catálogo de clientes: se derivan de sus ventas
  // GROUP BY nombre + teléfono. Los filtros de saldo/inactivos de la matriz
  // no aplican aquí. Las ventas sin nombre son de público general y se
  // reportan aparte como agregado.
  const condiciones: string[] = ["v.nombre_cliente IS NOT NULL", "v.nombre_cliente <> ''"];
  const params: unknown[] = [];
  if (f.busqueda) {
    condiciones.push("(v.nombre_cliente LIKE ? OR v.telefono_cliente LIKE ?)");
    params.push(`%${f.busqueda}%`, `%${f.busqueda}%`);
  }
  const where = `WHERE ${condiciones.join(" AND ")}`;
  const offset = (f.page - 1) * f.pageSize;

  try {
    const [filas, conteo, resumen, publico] = await Promise.all([
      consultaUsadas<FilaClienteUsado>(
        `SELECT v.nombre_cliente AS nombre,
                NULLIF(v.telefono_cliente, '') AS telefono,
                COUNT(*) AS compras,
                IFNULL(SUM(v.total), 0) AS importe,
                IFNULL(SUM(v.saldo), 0) AS saldo,
                MAX(v.fecha) AS ultimaCompra
           FROM ventas v
          ${where}
          GROUP BY v.nombre_cliente, v.telefono_cliente
          ORDER BY importe DESC, nombre ASC
          LIMIT ${offset}, ${f.pageSize}`,
        params
      ),
      consultaUsadas<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM (SELECT 1
                   FROM ventas v
                  ${where}
                  GROUP BY v.nombre_cliente, v.telefono_cliente) t`,
        params
      ),
      consultaUsadas<FilaResumenUsadas>(
        `SELECT COUNT(*)                  AS clientes,
                IFNULL(SUM(t.compras), 0) AS compras,
                IFNULL(SUM(t.importe), 0) AS importe,
                IFNULL(SUM(t.saldo), 0)   AS saldo
           FROM (SELECT COUNT(*)     AS compras,
                        SUM(v.total) AS importe,
                        SUM(v.saldo) AS saldo
                   FROM ventas v
                  ${where}
                  GROUP BY v.nombre_cliente, v.telefono_cliente) t`,
        params
      ),
      consultaUsadas<FilaPublicoGeneral>(
        `SELECT COUNT(*) AS ventas, IFNULL(SUM(v.total), 0) AS importe
           FROM ventas v
          WHERE v.nombre_cliente IS NULL OR v.nombre_cliente = ''`
      ),
    ]);

    return NextResponse.json({
      page: f.page,
      pageSize: f.pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      publicoGeneral: publico[0] ?? { ventas: 0, importe: 0 },
      clientes: filas,
    });
  } catch (error) {
    console.error("Error listando clientes de la Bodega Usado:", error);
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
  // page y pageSize se interpolan en LIMIT: deben ser enteros dentro de rango.
  const pagina = Number(searchParams.get("page"));
  const tamano = Number(searchParams.get("pageSize"));
  const filtros: Filtros = {
    busqueda: (searchParams.get("busqueda") ?? "").trim(),
    conSaldo: searchParams.get("conSaldo") === "1",
    incluirInactivos: searchParams.get("incluirInactivos") === "1",
    page: Number.isInteger(pagina) && pagina >= 1 ? Math.min(pagina, PAGE_MAX) : 1,
    pageSize:
      Number.isInteger(tamano) && tamano >= 1
        ? Math.min(tamano, PAGE_SIZE_MAX)
        : PAGE_SIZE_DEFAULT,
  };

  return sucursal === "usadas" ? listarUsadas(filtros) : listarMatriz(filtros);
}
