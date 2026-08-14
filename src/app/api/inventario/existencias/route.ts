import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el inventario completo
const MAX_PALABRAS = 5; // acota la búsqueda por palabras contra la base remota

// ---------- Matriz (bdav) ----------

interface FilaExistencia {
  id: number;
  codigo: string;
  descripcion: string | null;
  linea: string | null;
  parte: string | null;
  existencia: number;
  precioLista: number;
  valor: number;
  localizacion: string | null;
  minimo: number | null;
  maximo: number | null;
  reorden: number | null;
}

interface FilaResumen {
  codigos: number;
  piezas: number;
  valorLista: number;
  valorCosto: number;
}

interface FiltrosMatriz {
  busqueda: string;
  idLinea: number;
  idParte: number;
  pageSize: number;
  offset: number;
}

/** Existencias de la MATRIZ (bdav): reporte de inventario físico valuado. */
async function existenciasMatriz(f: FiltrosMatriz) {
  // Solo artículos con existencia; filtros siempre parametrizados.
  const condiciones: string[] = ["a.existencia > 0"];
  const params: unknown[] = [];
  if (f.busqueda) {
    // Código por prefijo (aprovecha índice) o descripción en cualquier posición.
    condiciones.push("(a.codigo LIKE ? OR a.descripcion LIKE ?)");
    params.push(`${f.busqueda}%`, `%${f.busqueda}%`);
  }
  if (Number.isInteger(f.idLinea) && f.idLinea > 0) {
    condiciones.push("a.id_linea = ?");
    params.push(f.idLinea);
  }
  if (Number.isInteger(f.idParte) && f.idParte > 0) {
    condiciones.push("a.id_parte = ?");
    params.push(f.idParte);
  }
  const where = condiciones.join(" AND ");

  const [filas, conteo, resumen] = await Promise.all([
    consultaBdav<FilaExistencia>(
      `SELECT a.id, a.codigo, a.descripcion, l.linea, p.parte,
              IFNULL(a.existencia, 0) AS existencia,
              IFNULL(a.precio_lista, 0) AS precioLista,
              IFNULL(a.precio_lista, 0) * IFNULL(a.existencia, 0) AS valor,
              a.localizacion, a.minimo, a.maximo, a.reorden
         FROM articulos a
         JOIN lineas l ON l.id = a.id_linea
         JOIN partes p ON p.id = a.id_parte
        WHERE ${where}
        ORDER BY valor DESC
        LIMIT ${f.offset}, ${f.pageSize}`,
      params
    ),
    consultaBdav<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM articulos a
         JOIN lineas l ON l.id = a.id_linea
         JOIN partes p ON p.id = a.id_parte
        WHERE ${where}`,
      params
    ),
    consultaBdav<FilaResumen>(
      `SELECT COUNT(*)                                          AS codigos,
              IFNULL(SUM(a.existencia), 0)                      AS piezas,
              IFNULL(SUM(a.precio_lista * a.existencia), 0)     AS valorLista,
              IFNULL(SUM(a.precio_cpa * a.existencia), 0)       AS valorCosto
         FROM articulos a
         JOIN lineas l ON l.id = a.id_linea
         JOIN partes p ON p.id = a.id_parte
        WHERE ${where}`,
      params
    ),
  ]);

  return { total: conteo[0]?.total ?? 0, resumen: resumen[0] ?? null, articulos: filas };
}

// ---------- Bodega Usado (wwapvi_bd-usadas, base remota) ----------

interface FilaPiezaUsada {
  id: number;
  codigo: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  anioInicio: number | null;
  anioFin: number | null;
  precio: number;
  existencia: number;
  ubicacion: string | null;
}

interface FilaResumenUsadas {
  codigos: number;
  piezas: number;
  valor: number;
}

interface FiltrosUsadas {
  busqueda: string;
  idMarca: number;
  idParte: number;
  conCatalogos: boolean;
  pageSize: number;
  offset: number;
}

/** Catálogos de la Bodega Usado para los selects de la página (son chicos:
 *  ~44 marcas, ~decenas de partes). Se piden solo la primera vez. */
async function catalogosUsadas() {
  const [marcas, partes] = await Promise.all([
    consultaUsadas<{ id: number; marca: string }>(
      "SELECT id_marca AS id, marca FROM marcas ORDER BY marca"
    ),
    consultaUsadas<{ id: number; parte: string }>(
      "SELECT id_parte AS id, parte FROM partes ORDER BY parte"
    ),
  ]);
  return { marcas, partes };
}

/** Existencias de la BODEGA USADO: piezas con existencia, valuadas sin IVA. */
async function existenciasUsadas(f: FiltrosUsadas) {
  const condiciones: string[] = ["p.existencia > 0"];
  const params: unknown[] = [];
  if (f.busqueda) {
    // Los códigos son compuestos (PTA-5-129-...): cada palabra debe aparecer
    // en el código o en la descripción, en cualquier posición. Casi todas las
    // descripciones terminan en "<n> PUERTAS": se compara sin ese sufijo para
    // que buscar "puerta" no devuelva todo el almacén.
    for (const palabra of f.busqueda.split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS)) {
      condiciones.push(
        "(p.codigo LIKE ? OR REGEXP_REPLACE(p.descripcion, '[0-9]+ PUERTAS$', '') LIKE ?)"
      );
      params.push(`%${palabra}%`, `%${palabra}%`);
    }
  }
  if (Number.isInteger(f.idMarca) && f.idMarca > 0) {
    condiciones.push("mo.id_marca = ?");
    params.push(f.idMarca);
  }
  if (Number.isInteger(f.idParte) && f.idParte > 0) {
    condiciones.push("p.id_parte = ?");
    params.push(f.idParte);
  }
  const where = condiciones.join(" AND ");

  // Base remota: 2 consultas en lugar de 3 (el total del listado es el mismo
  // COUNT del resumen). El resumen solo necesita el JOIN a modelos, que es el
  // único usado por los filtros (marca).
  const [filas, resumen, catalogos] = await Promise.all([
    consultaUsadas<FilaPiezaUsada>(
      `SELECT p.id_pieza AS id, p.codigo, p.descripcion,
              ma.marca, mo.modelo,
              NULLIF(p.anio_inicio, 0) AS anioInicio,
              NULLIF(p.anio_fin, 0) AS anioFin,
              IFNULL(p.precio, 0) AS precio,
              IFNULL(p.existencia, 0) AS existencia,
              CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion
         FROM piezas p
         LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
         LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
         LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
         LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
        WHERE ${where}
        ORDER BY IFNULL(p.precio, 0) * IFNULL(p.existencia, 0) DESC, p.codigo
        LIMIT ${f.offset}, ${f.pageSize}`,
      params
    ),
    consultaUsadas<FilaResumenUsadas>(
      `SELECT COUNT(*)                                   AS codigos,
              IFNULL(SUM(p.existencia), 0)               AS piezas,
              IFNULL(SUM(p.precio * p.existencia), 0)    AS valor
         FROM piezas p
         LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
        WHERE ${where}`,
      params
    ),
    f.conCatalogos ? catalogosUsadas() : Promise.resolve(null),
  ]);

  return {
    total: resumen[0]?.codigos ?? 0,
    resumen: resumen[0] ?? null,
    piezas: filas,
    catalogos,
  };
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  // page/pageSize se interpolan en el LIMIT: se exigen enteros positivos
  // (default si no) y pageSize se acota al máximo.
  const pageBruto = Number(searchParams.get("page"));
  const page = Number.isInteger(pageBruto) && pageBruto > 0 ? pageBruto : 1;
  const pageSizeBruto = Number(searchParams.get("pageSize"));
  const pageSize =
    Number.isInteger(pageSizeBruto) && pageSizeBruto > 0
      ? Math.min(PAGE_SIZE_MAX, pageSizeBruto)
      : PAGE_SIZE_DEFAULT;
  const offset = (page - 1) * pageSize;

  if (sucursal === "usadas") {
    try {
      const datos = await existenciasUsadas({
        busqueda,
        idMarca: Number(searchParams.get("idMarca")) || 0,
        idParte: Number(searchParams.get("idParte")) || 0,
        conCatalogos: searchParams.get("catalogos") === "1",
        pageSize,
        offset,
      });
      return NextResponse.json({
        sucursal,
        page,
        pageSize,
        total: datos.total,
        resumen: datos.resumen,
        piezas: datos.piezas,
        ...(datos.catalogos ? { catalogos: datos.catalogos } : {}),
      });
    } catch (error) {
      console.error("Error listando existencias (usadas):", error);
      return NextResponse.json(
        { error: "No fue posible consultar la base de la Bodega Usado" },
        { status: 502 }
      );
    }
  }

  try {
    const datos = await existenciasMatriz({
      busqueda,
      idLinea: Number(searchParams.get("idLinea")) || 0,
      idParte: Number(searchParams.get("idParte")) || 0,
      pageSize,
      offset,
    });
    return NextResponse.json({
      sucursal,
      page,
      pageSize,
      total: datos.total,
      resumen: datos.resumen,
      articulos: datos.articulos,
    });
  } catch (error) {
    console.error("Error listando existencias:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las existencias" },
      { status: 502 }
    );
  }
}
