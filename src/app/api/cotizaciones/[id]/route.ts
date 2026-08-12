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
  const idCotizacion = Number(id);
  if (!Number.isInteger(idCotizacion) || idCotizacion <= 0) {
    return NextResponse.json({ error: "Cotización inválida" }, { status: 400 });
  }

  try {
    const [encabezados, partidas] = await Promise.all([
      consultaBdav(
        `SELECT co.id, co.num_cotiza AS numCotiza, co.fecha_cot AS fecha,
                IFNULL(co.subtotal, 0) AS subtotal, IFNULL(co.iva, 0) AS iva,
                IFNULL(co.total, 0) AS total, co.estatus, co.observa,
                IFNULL(NULLIF(co.nombre, ''), c.nombre) AS cliente,
                co.telefono, c.rfc, c.telefono AS telefonoCliente
           FROM cotiza co
           LEFT JOIN clientes c ON c.id = co.id_cte
          WHERE co.id = ?`,
        [idCotizacion]
      ),
      consultaBdav(
        `SELECT d.partida, d.cantidad, a.codigo, a.descripcion,
                IFNULL(d.precio, 0) AS precio, IFNULL(d.total_partida, 0) AS totalPartida
           FROM detalle_cotiza d
           JOIN articulos a ON a.id = d.id_articulo
          WHERE d.id_cot = ?
          ORDER BY d.partida`,
        [idCotizacion]
      ),
    ]);

    const cotizacion = encabezados[0];
    if (!cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ cotizacion, partidas });
  } catch (error) {
    console.error(`Error consultando cotización ${idCotizacion}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle de la cotización" },
      { status: 502 }
    );
  }
}
