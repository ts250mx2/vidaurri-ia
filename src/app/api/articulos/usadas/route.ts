import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";

// Piezas equivalentes en la SUCURSAL PARTES USADAS para un artículo de bdav
// (patrón del precio de referencia de Aldo Autopartes, pero contra la base de
// la sucursal). Los catálogos no comparten códigos, así que el cruce es por
// marca + tipo de parte + traslape del rango de años de aplicación.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PIEZAS = 8;

interface FilaArticulo {
  id: number;
  codigo: string;
  linea: string;
  parte: string;
  aini: number | null;
  afin: number | null;
}

interface FilaPiezaUsada {
  codigo: string;
  descripcion: string;
  parte: string;
  marca: string;
  modelo: string;
  anioInicio: number | null;
  anioFin: number | null;
  precio: number;
  existencia: number;
  ubicacion: string | null;
}

/** Raíz del tipo de parte para cruzar catálogos: primera palabra en singular
 *  aproximado (bdav usa plural "FAROS", la sucursal singular "FARO"). */
function raizParte(parte: string): string {
  const primera = parte.trim().toUpperCase().split(/\s+/)[0] ?? "";
  return primera.replace(/S$/, "");
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Artículo inválido" }, { status: 400 });
  }

  try {
    const [articulo] = await consultaBdav<FilaArticulo>(
      `SELECT a.id, a.codigo, IFNULL(l.linea, '') AS linea, IFNULL(p.parte, '') AS parte,
              a.aini, a.afin
         FROM articulos a
         LEFT JOIN lineas l ON l.id = a.id_linea
         LEFT JOIN partes p ON p.id = a.id_parte
        WHERE a.id = ?`,
      [id]
    );
    if (!articulo) return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });

    const raiz = raizParte(articulo.parte);
    const marca = articulo.linea.trim();
    if (!raiz || !marca) return NextResponse.json({ encontrado: false, total: 0, piezas: [] });

    const condiciones: string[] = [
      "p.existencia > 0",
      "pa.parte LIKE ?",
      // La marca puede venir compuesta en la sucursal ("DODGE / CHRYSLER").
      "(ma.marca LIKE ? OR ? LIKE CONCAT('%', ma.marca, '%'))",
    ];
    const params: unknown[] = [`${raiz}%`, `%${marca}%`, marca];

    // Traslape de años solo si el artículo tiene rango; en la sucursal hay
    // piezas sin rango capturado (0/NULL) que se incluyen igual.
    const aini = Number(articulo.aini);
    const afin = Number(articulo.afin);
    if (aini > 1900 && afin > 1900) {
      condiciones.push(
        "(IFNULL(p.anio_inicio, 0) = 0 OR p.anio_inicio <= ?)",
        "(IFNULL(p.anio_fin, 0) = 0 OR p.anio_fin >= ?)"
      );
      params.push(afin, aini);
    }

    const filas = await consultaUsadas<FilaPiezaUsada & { total: number }>(
      `SELECT p.codigo, p.descripcion,
              IFNULL(pa.parte, '') AS parte,
              IFNULL(ma.marca, '') AS marca,
              IFNULL(mo.modelo, '') AS modelo,
              NULLIF(p.anio_inicio, 0) AS anioInicio, NULLIF(p.anio_fin, 0) AS anioFin,
              IFNULL(p.precio, 0) AS precio,
              IFNULL(p.existencia, 0) AS existencia,
              CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion,
              COUNT(*) OVER () AS total
         FROM piezas p
         LEFT JOIN partes pa ON pa.id_parte = p.id_parte
         LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
         LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
         LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
         LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
        WHERE ${condiciones.join(" AND ")}
        ORDER BY (p.precio > 0) DESC, p.precio ASC
        LIMIT ${MAX_PIEZAS}`,
      params
    );

    const total = filas[0]?.total ?? 0;
    const piezas: FilaPiezaUsada[] = filas.map((f) => ({
      codigo: f.codigo,
      descripcion: f.descripcion,
      parte: f.parte,
      marca: f.marca,
      modelo: f.modelo,
      anioInicio: f.anioInicio,
      anioFin: f.anioFin,
      precio: f.precio,
      existencia: f.existencia,
      ubicacion: f.ubicacion,
    }));
    return NextResponse.json({ encontrado: piezas.length > 0, total, piezas });
  } catch (error) {
    console.error("Error consultando piezas usadas del artículo:", error);
    // Distinguir "sin coincidencias" de "la base de la sucursal no respondió".
    return NextResponse.json(
      { encontrado: false, total: 0, piezas: [], error: "No se pudo consultar la sucursal" },
      { status: 502 }
    );
  }
}
