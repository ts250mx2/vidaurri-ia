import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaUsadas } from "@/lib/db-usadas";
import { raizBusqueda } from "@/lib/texto";

// Catálogo de PIEZAS USADAS (Bodega Usado): listado paginado con filtros.
// La búsqueda cruza descripción/código/parte/marca/modelo para que
// "puerta silverado" encuentre parte=PUERTA + modelo=SILVERADO.

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el catálogo completo
const MAX_PALABRAS = 6;

interface FilaPieza {
  idPieza: number;
  codigo: string;
  descripcion: string;
  parte: string;
  marca: string;
  modelo: string;
  anioInicio: number | null;
  anioFin: number | null;
  lado: string | null;
  precio: number;
  precioConIva: number;
  existencia: number;
  ubicacion: string | null;
  /** nombre_imagen de la primera foto activa; null si la pieza no tiene fotos. */
  fotoNombre: string | null;
}

interface FilaResumen {
  piezas: number;
  unidades: number;
  valor: number;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const idParte = Number(searchParams.get("idParte")) || 0;
  const idMarca = Number(searchParams.get("idMarca")) || 0;
  const conExistencia = searchParams.get("conExistencia") === "1";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  const condiciones: string[] = [];
  const params: unknown[] = [];
  const palabras = busqueda.split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS);
  for (const palabra of palabras) {
    condiciones.push(
      "(p.descripcion LIKE ? OR p.codigo LIKE ? OR pa.parte LIKE ? OR ma.marca LIKE ? OR mo.modelo LIKE ?)"
    );
    // Raíz de la palabra: "delantera" también cruza con "DELANTERO(A)".
    const like = `%${raizBusqueda(palabra)}%`;
    params.push(like, like, like, like, like);
  }
  if (Number.isInteger(idParte) && idParte > 0) {
    condiciones.push("p.id_parte = ?");
    params.push(idParte);
  }
  if (Number.isInteger(idMarca) && idMarca > 0) {
    condiciones.push("ma.id_marca = ?");
    params.push(idMarca);
  }
  if (conExistencia) condiciones.push("p.existencia > 0");
  const where = condiciones.length > 0 ? condiciones.join(" AND ") : "1";
  const offset = (page - 1) * pageSize;

  // Los filtros usan marcas vía modelos: los JOIN van también en conteo y resumen
  // para que los tres números salgan del mismo universo de filas.
  const joins = `FROM piezas p
       LEFT JOIN partes pa ON pa.id_parte = p.id_parte
       LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
       LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca`;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaUsadas<FilaPieza>(
        `SELECT p.id_pieza AS idPieza, p.codigo, p.descripcion,
                IFNULL(pa.parte, '') AS parte,
                IFNULL(ma.marca, '') AS marca,
                IFNULL(mo.modelo, '') AS modelo,
                NULLIF(p.anio_inicio, 0) AS anioInicio, NULLIF(p.anio_fin, 0) AS anioFin,
                p.lado,
                IFNULL(p.precio, 0) AS precio,
                ROUND(IFNULL(p.precio, 0) * 1.16, 2) AS precioConIva,
                IFNULL(p.existencia, 0) AS existencia,
                CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion,
                (SELECT pi.nombre_imagen FROM piezas_imagenes pi
                  WHERE pi.id_pieza = p.id_pieza AND pi.activo = 1
                    AND pi.consecutivo >= 1
                  ORDER BY pi.consecutivo LIMIT 1) AS fotoNombre
           ${joins}
           LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
           LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
          WHERE ${where}
          ORDER BY (p.existencia > 0) DESC, p.codigo ASC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaUsadas<{ total: number }>(
        `SELECT COUNT(*) AS total ${joins} WHERE ${where}`,
        params
      ),
      consultaUsadas<FilaResumen>(
        `SELECT COUNT(*)                                        AS piezas,
                IFNULL(SUM(p.existencia), 0)                    AS unidades,
                IFNULL(SUM(p.precio * p.existencia), 0)         AS valor
           ${joins}
          WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      piezas: filas,
    });
  } catch (error) {
    console.error("Error listando piezas usadas:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la Bodega Usado" },
      { status: 502 }
    );
  }
}
