import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo
const ESTATUS_VALIDOS = ["ABIERTO", "COMPLETO", "INCOMPLETO"];

interface FilaPedido {
  id: number;
  numPedido: number;
  fecha: string;
  proveedor: string;
  subtotal: number;
  iva: number;
  total: number;
  estatus: string | null;
}

interface FilaResumen {
  pedidos: number;
  importe: number;
  abiertos: number;
  incompletos: number;
  completos: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function diasAtrasISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  // Los pedidos son poco frecuentes: por defecto se consultan los últimos 30 días.
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : diasAtrasISO(30);
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoyISO();
  const estatus = searchParams.get("estatus") ?? "";
  const idProv = Number(searchParams.get("idProv"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["p.fecha BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (ESTATUS_VALIDOS.includes(estatus)) {
    condiciones.push("p.estatus = ?");
    params.push(estatus);
  }
  if (Number.isInteger(idProv) && idProv > 0) {
    condiciones.push("p.id_prov = ?");
    params.push(idProv);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaPedido>(
        `SELECT p.id, p.num_pedido AS numPedido, p.fecha,
                IFNULL(p.subtotal, 0) AS subtotal, IFNULL(p.iva, 0) AS iva,
                IFNULL(p.total, 0) AS total, p.estatus,
                pr.nombre AS proveedor
           FROM pedidos p
           JOIN proveedores pr ON pr.id = p.id_prov
          WHERE ${where}
          ORDER BY p.fecha DESC, p.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM pedidos p
           JOIN proveedores pr ON pr.id = p.id_prov
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                        AS pedidos,
                IFNULL(SUM(p.total), 0)         AS importe,
                SUM(p.estatus = 'ABIERTO')      AS abiertos,
                SUM(p.estatus = 'INCOMPLETO')   AS incompletos,
                SUM(p.estatus = 'COMPLETO')     AS completos
           FROM pedidos p
           JOIN proveedores pr ON pr.id = p.id_prov
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
      pedidos: filas,
    });
  } catch (error) {
    console.error("Error listando pedidos a proveedor:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los pedidos" },
      { status: 502 }
    );
  }
}
