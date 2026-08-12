import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const idCliente = Number(id);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  }

  try {
    const [encabezados, ultimasVentas, pagos, totales] = await Promise.all([
      consultaBdav(
        // Los bit(1) llegan como Buffer con mysql2: (campo + 0) los convierte a 0/1.
        `SELECT c.id, c.nombre, c.rfc, c.telefono, c.email,
                c.calle, c.numero, c.colonia, c.codpost, c.ciudad, c.estado,
                IFNULL(c.descuento, 0) AS descuento,
                IFNULL(c.limite_credito, 0) AS limiteCredito,
                IFNULL(c.saldo, 0) AS saldo,
                (c.activo + 0) AS activo,
                (c.bloqueo_por_adeudo + 0) AS bloqueado
           FROM clientes c
          WHERE c.id = ?`,
        [idCliente]
      ),
      consultaBdav(
        `SELECT v.num_venta AS numVenta, v.serie, v.fecha,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo, v.estatus
           FROM ventas v
          WHERE v.id_cliente = ?
          ORDER BY v.id DESC
          LIMIT 20`,
        [idCliente]
      ),
      consultaBdav(
        `SELECT p.num_pago AS numPago, p.fecha_pago AS fechaPago,
                p.forma_pago AS formaPago, p.num_referencia AS numReferencia,
                IFNULL(p.total_pago, 0) AS totalPago, p.estatus_pago AS estatusPago
           FROM pagos_ventas p
          WHERE p.id_cliente = ?
          ORDER BY p.fecha_pago DESC
          LIMIT 20`,
        [idCliente]
      ),
      consultaBdav<{ ventas: number; importe: number }>(
        `SELECT COUNT(*) AS ventas, IFNULL(SUM(v.total), 0) AS importe
           FROM ventas v
          WHERE v.id_cliente = ?`,
        [idCliente]
      ),
    ]);

    const cliente = encabezados[0];
    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      cliente,
      ultimasVentas,
      pagos,
      totales: totales[0] ?? null,
    });
  } catch (error) {
    console.error(`Error consultando cliente ${idCliente}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle del cliente" },
      { status: 502 }
    );
  }
}
