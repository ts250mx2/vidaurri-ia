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
  const idFactura = Number(id);
  if (!Number.isInteger(idFactura) || idFactura <= 0) {
    return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  }

  try {
    const [encabezados, partidas] = await Promise.all([
      consultaBdav(
        `SELECT fc.id, fc.num_factura AS numFactura, fc.fecha_factura AS fechaFactura,
                pr.nombre AS proveedor, c.num_compra AS numCompra,
                c.fecha_compra AS fechaCompra,
                IFNULL(fc.subtotal, 0) AS subtotal, IFNULL(fc.iva, 0) AS iva,
                IFNULL(fc.total, 0) AS total, IFNULL(fc.saldo, 0) AS saldo,
                fc.estatus, fc.comentarios
           FROM facturas_compras fc
           JOIN compras c      ON c.id = fc.id_compra
           JOIN proveedores pr ON pr.id = c.id_prov
          WHERE fc.id = ?`,
        [idFactura]
      ),
      consultaBdav(
        `SELECT d.partida, a.codigo, a.descripcion, d.cantidad,
                IFNULL(d.precio_compra, 0) AS precioCompra,
                IFNULL(d.total_part, 0) AS totalPart
           FROM detalle_factura_compra d
           JOIN articulos a ON a.id = d.id_articulo
          WHERE d.id_fact_compra = ?
          ORDER BY d.partida`,
        [idFactura]
      ),
    ]);

    const factura = encabezados[0];
    if (!factura) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

    return NextResponse.json({ factura, partidas });
  } catch (error) {
    console.error(`Error consultando factura de compra ${idFactura}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle de la factura" },
      { status: 502 }
    );
  }
}
