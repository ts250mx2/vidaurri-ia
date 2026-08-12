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
  const idBko = Number(id);
  if (!Number.isInteger(idBko) || idBko <= 0) {
    return NextResponse.json({ error: "Back order inválido" }, { status: 400 });
  }

  try {
    const [encabezados, partidas, ventasLigadas] = await Promise.all([
      consultaBdav(
        `SELECT b.id, b.num_bko AS numBko, b.fecha_bko AS fechaBko,
                IFNULL(NULLIF(b.nombre_cliente, ''), c.nombre) AS cliente,
                IFNULL(NULLIF(b.telefono, ''), c.telefono) AS telefono,
                ve.vendedor, p.nombre AS proveedor,
                IFNULL(b.subtotal, 0) AS subtotal, IFNULL(b.iva, 0) AS iva,
                IFNULL(b.total, 0) AS total, IFNULL(b.anticipo, 0) AS anticipo,
                IFNULL(b.liquida, 0) AS liquida, IFNULL(b.saldo, 0) AS saldo,
                b.estatus, b.fecha_compromiso AS fechaCompromiso, b.comentarios
           FROM back_order b
           JOIN clientes c     ON c.id = b.id_cte
           JOIN vendedores ve  ON ve.id = b.id_vendedor
           JOIN proveedores p  ON p.id = b.id_prov
          WHERE b.id = ?`,
        [idBko]
      ),
      consultaBdav(
        `SELECT d.partida, a.codigo, a.descripcion, d.cantidad,
                IFNULL(d.precio, 0) AS precio, IFNULL(d.total_part, 0) AS totalPart,
                d.estatus, IFNULL(d.cant_recibida, 0) AS cantRecibida,
                d.fecha_llegada AS fechaLlegada
           FROM detalle_bko d
           JOIN articulos a ON a.id = d.id_art
          WHERE d.id_bko = ?
          ORDER BY d.partida`,
        [idBko]
      ),
      consultaBdav(
        `SELECT v.id, v.num_venta AS numVenta, v.serie, v.fecha,
                IFNULL(v.total, 0) AS total
           FROM backorder_venta bv
           JOIN ventas v ON v.id = bv.id_vta
          WHERE bv.id_bko = ?
          ORDER BY v.fecha`,
        [idBko]
      ),
    ]);

    const backOrder = encabezados[0];
    if (!backOrder) {
      return NextResponse.json({ error: "Back order no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ backOrder, partidas, ventasLigadas });
  } catch (error) {
    console.error(`Error consultando back order ${idBko}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle del back order" },
      { status: 502 }
    );
  }
}
