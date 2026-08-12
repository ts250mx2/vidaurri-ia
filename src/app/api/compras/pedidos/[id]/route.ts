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
  const idPedido = Number(id);
  if (!Number.isInteger(idPedido) || idPedido <= 0) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  try {
    const [encabezados, partidas] = await Promise.all([
      consultaBdav(
        `SELECT p.id, p.num_pedido AS numPedido, p.fecha,
                IFNULL(p.subtotal, 0) AS subtotal, IFNULL(p.iva, 0) AS iva,
                IFNULL(p.total, 0) AS total, p.estatus,
                pr.nombre AS proveedor
           FROM pedidos p
           JOIN proveedores pr ON pr.id = p.id_prov
          WHERE p.id = ?`,
        [idPedido]
      ),
      // detalle_pedido es enorme (846k filas) pero id_pedido está indexado.
      consultaBdav(
        `SELECT d.partida,
                IFNULL(NULLIF(d.codigo, ''), a.codigo) AS codigo,
                a.descripcion, d.cantidad,
                IFNULL(d.cant_recibida, 0) AS cantRecibida,
                IFNULL(d.cant_pdte, 0) AS cantPdte,
                IFNULL(d.total_partida, 0) AS totalPartida
           FROM detalle_pedido d
           JOIN articulos a ON a.id = d.id_articulo
          WHERE d.id_pedido = ?
          ORDER BY d.partida`,
        [idPedido]
      ),
    ]);

    const pedido = encabezados[0];
    if (!pedido) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

    return NextResponse.json({ pedido, partidas });
  } catch (error) {
    console.error(`Error consultando pedido ${idPedido}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle del pedido" },
      { status: 502 }
    );
  }
}
