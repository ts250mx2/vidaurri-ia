import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaUsadas } from "@/lib/db-usadas";

// Detalle de una pieza usada: ficha completa + lista de sus fotos (consecutivos
// activos en piezas_imagenes) para la galería del modal.

export const dynamic = "force-dynamic";

const MAX_FOTOS = 12;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const idPieza = Number(id);
  if (!Number.isInteger(idPieza) || idPieza <= 0) {
    return NextResponse.json({ error: "Pieza inválida" }, { status: 400 });
  }

  try {
    const [piezas, fotos] = await Promise.all([
      consultaUsadas(
        `SELECT p.id_pieza AS idPieza, p.codigo, p.descripcion,
                IFNULL(pa.parte, '') AS parte,
                IFNULL(ma.marca, '') AS marca,
                IFNULL(mo.modelo, '') AS modelo,
                NULLIF(p.anio_inicio, 0) AS anioInicio, NULLIF(p.anio_fin, 0) AS anioFin,
                p.lado, p.posicion, p.puertas, p.origen, p.numeroparte AS numeroParte,
                IFNULL(p.precio, 0) AS precio,
                ROUND(IFNULL(p.precio, 0) * 1.16, 2) AS precioConIva,
                IFNULL(p.existencia, 0) AS existencia,
                CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion,
                p.comentarios
           FROM piezas p
           LEFT JOIN partes pa ON pa.id_parte = p.id_parte
           LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
           LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
           LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
           LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
          WHERE p.id_pieza = ?`,
        [idPieza]
      ),
      // consecutivo >= 1: los registros con consecutivo 0 son legacy y sus
      // archivos ya no existen en el servidor de la bodega.
      consultaUsadas<{ nombreImagen: string }>(
        `SELECT nombre_imagen AS nombreImagen FROM piezas_imagenes
          WHERE id_pieza = ? AND activo = 1 AND consecutivo >= 1
          ORDER BY consecutivo
          LIMIT ${MAX_FOTOS}`,
        [idPieza]
      ),
    ]);

    const pieza = piezas[0];
    if (!pieza) return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 });

    return NextResponse.json({ pieza, fotos: fotos.map((f) => f.nombreImagen) });
  } catch (error) {
    console.error(`Error consultando pieza usada ${idPieza}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar la Bodega Usado" },
      { status: 502 }
    );
  }
}
