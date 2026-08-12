import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el catálogo completo

interface FilaArticulo {
  id: number;
  codigo: string;
  descripcion: string;
  linea: string;
  parte: string;
  aini: string | number | null;
  afin: string | number | null;
  precioLista: number;
  precioVta: number;
  existencia: number;
  localizacion: string | null;
}

interface FilaResumen {
  codigos: number;
  codigosConExistencia: number;
  piezas: number;
  valorLista: number;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const idLinea = Number(searchParams.get("idLinea")) || 0;
  const idParte = Number(searchParams.get("idParte")) || 0;
  const conExistencia = searchParams.get("conExistencia") === "1";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados. Solo referencian columnas de
  // `articulos` para poder reutilizar el WHERE sin joins en conteo y resumen.
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (busqueda) {
    // Código por prefijo, descripción por contenido, o código alterno por prefijo.
    // IN (subquery) y no EXISTS correlacionado: codigos_alternos no tiene índice
    // por id_articulo y el EXISTS por fila tardaba minutos (42k × 15k filas).
    condiciones.push(
      `(a.codigo LIKE ? OR a.descripcion LIKE ? OR a.id IN (
         SELECT ca.id_articulo FROM codigos_alternos ca WHERE ca.codigo_alterno LIKE ?
       ))`
    );
    params.push(`${busqueda}%`, `%${busqueda}%`, `${busqueda}%`);
  }
  if (Number.isInteger(idLinea) && idLinea > 0) {
    condiciones.push("a.id_linea = ?");
    params.push(idLinea);
  }
  if (Number.isInteger(idParte) && idParte > 0) {
    condiciones.push("a.id_parte = ?");
    params.push(idParte);
  }
  if (conExistencia) {
    condiciones.push("a.existencia > 0");
  }
  const where = condiciones.length > 0 ? condiciones.join(" AND ") : "1";
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaArticulo>(
        // LEFT JOIN: no se descartan artículos con línea/parte sin registrar.
        `SELECT a.id, a.codigo, a.descripcion,
                IFNULL(l.linea, '') AS linea, IFNULL(p.parte, '') AS parte,
                a.aini, a.afin,
                IFNULL(a.precio_lista, 0) AS precioLista,
                IFNULL(a.precio_vta, 0) AS precioVta,
                IFNULL(a.existencia, 0) AS existencia,
                a.localizacion
           FROM articulos a
           LEFT JOIN lineas l ON l.id = a.id_linea
           LEFT JOIN partes p ON p.id = a.id_parte
          WHERE ${where}
          ORDER BY a.codigo ASC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM articulos a
          WHERE ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                                          AS codigos,
                IFNULL(SUM(a.existencia > 0), 0)                  AS codigosConExistencia,
                IFNULL(SUM(a.existencia), 0)                      AS piezas,
                IFNULL(SUM(a.precio_lista * a.existencia), 0)     AS valorLista
           FROM articulos a
          WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      articulos: filas,
    });
  } catch (error) {
    console.error("Error listando artículos:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los artículos" },
      { status: 502 }
    );
  }
}
