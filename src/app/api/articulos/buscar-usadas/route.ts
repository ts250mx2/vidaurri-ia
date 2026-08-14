import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaUsadas } from "@/lib/db-usadas";
import { raizBusqueda } from "@/lib/texto";

// Búsqueda LIBRE en el catálogo de la BODEGA USADO por texto. La usa el
// catálogo de Artículos como respaldo: cuando la búsqueda no encuentra nada en
// la Matriz, se ofrece lo que sí hay en la sucursal de piezas usadas.
// Cada palabra debe aparecer en descripción, código, tipo de parte, marca o
// modelo (así "puerta jeep" cruza parte=PUERTA con marca=JEEP).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PIEZAS = 30;
const MAX_PALABRAS = 6;

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

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const busqueda = (new URL(request.url).searchParams.get("busqueda") ?? "").trim();
  const palabras = busqueda.split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS);
  if (palabras.length === 0) {
    return NextResponse.json({ encontrado: false, total: 0, piezas: [] });
  }

  const condiciones: string[] = ["p.existencia > 0"];
  const params: unknown[] = [];
  for (const palabra of palabras) {
    condiciones.push(
      `(p.descripcion LIKE ? OR p.codigo LIKE ? OR pa.parte LIKE ? OR ma.marca LIKE ? OR mo.modelo LIKE ?)`
    );
    // Raíz de la palabra: "delantera" también cruza con "DELANTERO(A)".
    const like = `%${raizBusqueda(palabra)}%`;
    params.push(like, like, like, like, like);
  }

  // Relevancia: primero las piezas cuyo TIPO de parte coincide con alguna
  // palabra (que "puerta silverado" liste puertas antes que piezas cuya
  // descripción solo dice "4 puertas").
  const coincideParte = `(${palabras.map(() => "pa.parte LIKE ?").join(" OR ")})`;
  const paramsOrden = palabras.map((p) => `%${raizBusqueda(p)}%`);

  try {
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
        ORDER BY ${coincideParte} DESC, (p.precio > 0) DESC, p.precio ASC
        LIMIT ${MAX_PIEZAS}`,
      [...params, ...paramsOrden]
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
    console.error("Error buscando en la Bodega Usado:", error);
    return NextResponse.json(
      { encontrado: false, total: 0, piezas: [], error: "No se pudo consultar la sucursal" },
      { status: 502 }
    );
  }
}
