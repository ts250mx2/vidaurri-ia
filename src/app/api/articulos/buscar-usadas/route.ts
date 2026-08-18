import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaUsadas } from "@/lib/db-usadas";
import { condicionesPorPalabra, expresionRelevancia } from "@/lib/busqueda";

// Búsqueda LIBRE en el catálogo de la BODEGA USADO por texto. La usa el
// catálogo de Artículos como respaldo: cuando la búsqueda no encuentra nada en
// la Matriz, se ofrece lo que sí hay en la sucursal de piezas usadas.
// Cada palabra debe aparecer en descripción, código, tipo de parte, marca o
// modelo (así "puerta jeep" cruza parte=PUERTA con marca=JEEP).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PIEZAS = 30;

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
  if (!busqueda) {
    return NextResponse.json({ encontrado: false, total: 0, piezas: [] });
  }

  const condiciones: string[] = ["p.existencia > 0"];
  const params: unknown[] = [];
  // Cada palabra cruza descripción/código/parte/marca/modelo, incluyendo sus
  // sinónimos y abreviaturas ("facia" encuentra FASCIA, "capó" encuentra COFRE).
  const palabras = condicionesPorPalabra(
    busqueda,
    ["p.descripcion", "p.codigo", "pa.parte", "ma.marca", "mo.modelo"],
    condiciones,
    params
  );

  // Relevancia: primero las piezas cuyo TIPO de parte coincide (que "puerta
  // silverado" liste puertas antes que piezas cuya descripción solo dice
  // "4 puertas"), y después las del lado que pidió el cliente.
  const paramsOrden: unknown[] = [];
  const coincideParte = expresionRelevancia(palabras.requeridas, ["pa.parte"], paramsOrden);
  const coincidePosicion = expresionRelevancia(
    palabras.opcionales,
    ["p.descripcion"],
    paramsOrden
  );

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
        ORDER BY ${coincideParte} DESC, ${coincidePosicion} DESC,
                 (p.precio > 0) DESC, p.precio ASC
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
