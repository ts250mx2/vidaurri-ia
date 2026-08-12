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
  const idVenta = Number(id);
  if (!Number.isInteger(idVenta) || idVenta <= 0) {
    return NextResponse.json({ error: "Venta inválida" }, { status: 400 });
  }

  try {
    const [encabezados, partidas, formasPago] = await Promise.all([
      consultaBdav(
        `SELECT v.id, v.num_venta AS numVenta, v.serie, v.fecha,
                IFNULL(v.subtotal, 0) AS subtotal, IFNULL(v.iva, 0) AS iva,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo,
                v.estatus, v.num_cotiza AS numCotiza, v.observa,
                IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente,
                c.rfc, c.telefono AS telefonoCliente, v.telefono AS telefonoVenta
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE v.id = ?`,
        [idVenta]
      ),
      consultaBdav(
        `SELECT d.partida, d.cantidad, a.codigo, a.descripcion,
                IFNULL(d.precio, 0) AS precio, IFNULL(d.total_partida, 0) AS totalPartida,
                d.devolucion, d.num_devol AS numDevol
           FROM detalle_venta d
           JOIN articulos a ON a.id = d.id_articulo
          WHERE d.id_venta = ?
          ORDER BY d.partida`,
        [idVenta]
      ),
      consultaBdav(
        `SELECT fp.describe_pago AS formaPago, u.nombre AS usuario
           FROM venta_formapago vf
           JOIN forma_pago fp ON fp.id = vf.id_formapago
           JOIN usuarios u    ON u.id = vf.id_usuario
          WHERE vf.id_venta = ?`,
        [idVenta]
      ),
    ]);

    const venta = encabezados[0];
    if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

    // Nota: la base no liga devoluciones con la venta origen (detalle_venta.num_devol
    // nunca se llena y devoluciones no referencia la venta), por eso no se incluyen aquí.
    return NextResponse.json({ venta, partidas, formasPago });
  } catch (error) {
    console.error(`Error consultando venta ${idVenta}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle de la venta" },
      { status: 502 }
    );
  }
}
