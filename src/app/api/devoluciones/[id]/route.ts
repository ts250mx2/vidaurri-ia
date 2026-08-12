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
  const idDevolucion = Number(id);
  if (!Number.isInteger(idDevolucion) || idDevolucion <= 0) {
    return NextResponse.json({ error: "Devolución inválida" }, { status: 400 });
  }

  try {
    const [encabezados, partidas] = await Promise.all([
      consultaBdav(
        `SELECT d.id, d.num_devolucion AS numDevolucion, d.fecha_devolucion AS fecha,
                IFNULL(d.subtotal, 0) AS subtotal, IFNULL(d.iva, 0) AS iva,
                IFNULL(d.total, 0) AS total, d.estatus_devolucion AS estatus
           FROM devoluciones d
          WHERE d.id = ?`,
        [idDevolucion]
      ),
      consultaBdav(
        `SELECT dd.partida, dd.cantidad, a.codigo, a.descripcion,
                IFNULL(dd.precio, 0) AS precio,
                IFNULL(dd.total_partida, 0) AS totalPartida,
                dd.causa_devolucion AS causaDevolucion
           FROM devoluciones_detalle dd
           JOIN articulos a ON a.id = dd.id_articulo
          WHERE dd.id_devolucion = ?
          ORDER BY dd.partida`,
        [idDevolucion]
      ),
    ]);

    const devolucion = encabezados[0];
    if (!devolucion) {
      return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ devolucion, partidas });
  } catch (error) {
    console.error(`Error consultando devolución ${idDevolucion}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle de la devolución" },
      { status: 502 }
    );
  }
}
