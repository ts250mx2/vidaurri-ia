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
  const idArticulo = Number(id);
  if (!Number.isInteger(idArticulo) || idArticulo <= 0) {
    return NextResponse.json({ error: "Artículo inválido" }, { status: 400 });
  }

  try {
    const [encabezados, aplicaciones, codigosAlternos, ultimosMovimientos] =
      await Promise.all([
        consultaBdav(
          // LEFT JOIN: catálogos opcionales no deben ocultar el artículo.
          `SELECT a.id, a.codigo, a.descripcion,
                  IFNULL(l.linea, '') AS linea, IFNULL(p.parte, '') AS parte,
                  IFNULL(pr.nombre, '') AS proveedor,
                  IFNULL(a.precio_lista, 0) AS precioLista,
                  IFNULL(a.precio_cpa, 0) AS precioCpa,
                  IFNULL(a.descuento, 0) AS descuento,
                  IFNULL(a.precio_vta, 0) AS precioVta,
                  IFNULL(a.utilidad, 0) AS utilidad,
                  IFNULL(a.existencia, 0) AS existencia,
                  IFNULL(a.minimo, 0) AS minimo,
                  IFNULL(a.maximo, 0) AS maximo,
                  IFNULL(a.reorden, 0) AS reorden,
                  a.localizacion, a.aini, a.afin
             FROM articulos a
             LEFT JOIN lineas l ON l.id = a.id_linea
             LEFT JOIN partes p ON p.id = a.id_parte
             LEFT JOIN proveedores pr ON pr.id = a.id_prov
            WHERE a.id = ?`,
          [idArticulo]
        ),
        consultaBdav(
          // La tabla lleva guion en el nombre: backticks obligatorios.
          `SELECT m.modelo, am.aini, am.afin
             FROM \`art-mod\` am
             JOIN modelos m ON m.id = am.id_modelo
            WHERE am.id_articulo = ?
            ORDER BY m.modelo ASC`,
          [idArticulo]
        ),
        consultaBdav(
          `SELECT ca.codigo, ca.codigo_alterno AS codigoAlterno
             FROM codigos_alternos ca
            WHERE ca.id_articulo = ?
            ORDER BY ca.codigo_alterno ASC`,
          [idArticulo]
        ),
        consultaBdav(
          `SELECT mv.fecha, mv.tipo_mov AS tipoMov, mv.tipo_doc AS tipoDoc,
                  mv.num_doc AS numDoc,
                  IFNULL(mv.exist_ant, 0) AS existAnt,
                  IFNULL(mv.cantidad, 0) AS cantidad,
                  IFNULL(mv.exist_post, 0) AS existPost,
                  IFNULL(u.nombre, '') AS usuario
             FROM mov_articulos mv
             LEFT JOIN usuarios u ON u.id = mv.id_usuario
            WHERE mv.id_articulo = ?
            ORDER BY mv.id DESC
            LIMIT 15`,
          [idArticulo]
        ),
      ]);

    const articulo = encabezados[0];
    if (!articulo) {
      return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ articulo, aplicaciones, codigosAlternos, ultimosMovimientos });
  } catch (error) {
    console.error(`Error consultando artículo ${idArticulo}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle del artículo" },
      { status: 502 }
    );
  }
}
