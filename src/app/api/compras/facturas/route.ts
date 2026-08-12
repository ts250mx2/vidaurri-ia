import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el rango completo

interface FilaFactura {
  id: number;
  numFactura: string;
  fechaFactura: string;
  proveedor: string;
  numCompra: number;
  subtotal: number;
  iva: number;
  total: number;
  saldo: number;
  estatus: string | null;
  comentarios: string | null;
}

interface FilaResumen {
  facturas: number;
  importe: number;
  saldoPendiente: number;
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
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : diasAtrasISO(30);
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoyISO();
  // El estatus de facturas_compras es texto libre: se filtra por igualdad exacta.
  const estatus = (searchParams.get("estatus") ?? "").trim();
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  const condiciones: string[] = ["fc.fecha_factura BETWEEN ? AND ?"];
  const params: unknown[] = [fechaInicio, fechaFin];
  if (estatus) {
    condiciones.push("fc.estatus = ?");
    params.push(estatus);
  }
  if (busqueda) {
    // Prefijo del número de factura: aprovecha índice y es el uso natural.
    condiciones.push("fc.num_factura LIKE ?");
    params.push(`${busqueda}%`);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaFactura>(
        `SELECT fc.id, fc.num_factura AS numFactura, fc.fecha_factura AS fechaFactura,
                pr.nombre AS proveedor, c.num_compra AS numCompra,
                IFNULL(fc.subtotal, 0) AS subtotal, IFNULL(fc.iva, 0) AS iva,
                IFNULL(fc.total, 0) AS total, IFNULL(fc.saldo, 0) AS saldo,
                fc.estatus, fc.comentarios
           FROM facturas_compras fc
           JOIN compras c      ON c.id = fc.id_compra
           JOIN proveedores pr ON pr.id = c.id_prov
          WHERE ${where}
          ORDER BY fc.fecha_factura DESC, fc.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM facturas_compras fc
           JOIN compras c      ON c.id = fc.id_compra
           JOIN proveedores pr ON pr.id = c.id_prov
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                  AS facturas,
                IFNULL(SUM(fc.total), 0)  AS importe,
                IFNULL(SUM(fc.saldo), 0)  AS saldoPendiente
           FROM facturas_compras fc
           JOIN compras c      ON c.id = fc.id_compra
           JOIN proveedores pr ON pr.id = c.id_prov
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
      facturas: filas,
    });
  } catch (error) {
    console.error("Error listando facturas de compra:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las facturas de compra" },
      { status: 502 }
    );
  }
}
