import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";

// Resumen de piezas equivalentes en la BODEGA USADO para un LOTE de artículos
// de bdav (columnas "Bodega Usado" de la tabla del catálogo). El cruce por
// artículo replica /api/articulos/usadas: marca + raíz del tipo de parte +
// traslape del rango de años; aquí solo se agregan conteo y precio mínimo,
// en UNA sola consulta a la base remota (UNION ALL de agregados por llave).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IDS = 60;
const TTL_CACHE_MS = 5 * 60 * 1000; // 5 min (patrón del caché de src/lib/aldo.ts)

interface FilaArticulo {
  id: number;
  linea: string;
  parte: string;
  aini: string | number | null;
  afin: string | number | null;
}

interface ResumenUsadas {
  /** Piezas con existencia que cruzan con el artículo. */
  piezas: number;
  /** Precio mínimo (sin IVA) entre esas piezas; null si ninguna tiene precio. */
  desde: number | null;
}

interface FilaAgregado {
  clave: string;
  piezas: number;
  desde: number | null;
}

/** Raíz del tipo de parte para cruzar catálogos: primera palabra en singular
 *  aproximado (bdav usa plural "FAROS", la Bodega singular "FARO"). */
function raizParte(parte: string): string {
  const primera = parte.trim().toUpperCase().split(/\s+/)[0] ?? "";
  return primera.replace(/S$/, "");
}

interface LlaveCruce {
  /** Identificador estable de la combinación marca + raíz + rango de años. */
  clave: string;
  raiz: string;
  marca: string;
  /** Rango de años del artículo; null cuando no tiene rango capturado. */
  aini: number | null;
  afin: number | null;
}

/** Llave de cruce del artículo, o null si no hay marca/parte con qué cruzar. */
function llaveCruce(articulo: FilaArticulo): LlaveCruce | null {
  const raiz = raizParte(articulo.parte);
  const marca = articulo.linea.trim();
  if (!raiz || !marca) return null;
  // Traslape de años solo si el artículo tiene rango; 0/NULL actúa de comodín.
  const aini = Number(articulo.aini);
  const afin = Number(articulo.afin);
  const conRango = aini > 1900 && afin > 1900;
  return {
    clave: `${marca.toUpperCase()}|${raiz}|${conRango ? `${aini}-${afin}` : "*"}`,
    raiz,
    marca,
    aini: conRango ? aini : null,
    afin: conRango ? afin : null,
  };
}

// Caché en memoria por llave de cruce: muchas filas del catálogo comparten
// marca/parte/años, y la existencia de la Bodega cambia poco entre páginas.
const cache = new Map<string, { valor: ResumenUsadas; expira: number }>();

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const brutos = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const numeros = brutos.map(Number);
  if (
    numeros.length === 0 ||
    numeros.length > MAX_IDS ||
    numeros.some((n) => !Number.isInteger(n) || n <= 0)
  ) {
    return NextResponse.json({ error: "Ids inválidos" }, { status: 400 });
  }
  const ids = Array.from(new Set(numeros));

  // Datos de cruce de los artículos, en una sola consulta a bdav.
  let filas: FilaArticulo[];
  try {
    filas = await consultaBdav<FilaArticulo>(
      `SELECT a.id, IFNULL(l.linea, '') AS linea, IFNULL(p.parte, '') AS parte,
              a.aini, a.afin
         FROM articulos a
         LEFT JOIN lineas l ON l.id = a.id_linea
         LEFT JOIN partes p ON p.id = a.id_parte
        WHERE a.id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
  } catch (error) {
    console.error("Error consultando artículos para el lote de la Bodega Usado:", error);
    return NextResponse.json({ error: "Error al consultar artículos" }, { status: 500 });
  }

  // Agrupa artículos con llave idéntica para no repetir consultas, y separa
  // las llaves que aún no están en el caché vigente.
  const llavePorId = new Map<number, string>();
  const pendientes = new Map<string, LlaveCruce>();
  const ahora = Date.now();
  for (const fila of filas) {
    const llave = llaveCruce(fila);
    if (!llave) continue;
    llavePorId.set(fila.id, llave.clave);
    const enCache = cache.get(llave.clave);
    if (!enCache || enCache.expira <= ahora) {
      // La entrada vencida se borra para que el caché no crezca sin límite.
      if (enCache) cache.delete(llave.clave);
      pendientes.set(llave.clave, llave);
    }
  }

  // UNA consulta a la Bodega Usado: un agregado por llave, unidos con UNION ALL.
  if (pendientes.size > 0) {
    const bloques: string[] = [];
    const params: unknown[] = [];
    for (const llave of pendientes.values()) {
      const condiciones: string[] = [
        "p.existencia > 0",
        "pa.parte LIKE ?",
        // La marca puede venir compuesta en la Bodega ("DODGE / CHRYSLER").
        "(ma.marca LIKE ? OR ? LIKE CONCAT('%', ma.marca, '%'))",
      ];
      params.push(llave.clave, `${llave.raiz}%`, `%${llave.marca}%`, llave.marca);
      if (llave.aini !== null && llave.afin !== null) {
        condiciones.push(
          "(IFNULL(p.anio_inicio, 0) = 0 OR p.anio_inicio <= ?)",
          "(IFNULL(p.anio_fin, 0) = 0 OR p.anio_fin >= ?)"
        );
        params.push(llave.afin, llave.aini);
      }
      bloques.push(
        `SELECT ? AS clave, COUNT(*) AS piezas, MIN(NULLIF(p.precio, 0)) AS desde
           FROM piezas p
           JOIN partes pa ON pa.id_parte = p.id_parte
           JOIN modelos mo ON mo.id_modelo = p.id_modelo
           JOIN marcas ma ON ma.id_marca = mo.id_marca
          WHERE ${condiciones.join(" AND ")}`
      );
    }
    try {
      const agregados = await consultaUsadas<FilaAgregado>(
        bloques.join("\nUNION ALL\n"),
        params
      );
      const expira = Date.now() + TTL_CACHE_MS;
      for (const fila of agregados) {
        cache.set(fila.clave, {
          valor: { piezas: fila.piezas, desde: fila.desde },
          expira,
        });
      }
    } catch (error) {
      console.error("Error consultando el lote de la Bodega Usado:", error);
      return NextResponse.json(
        { error: "No fue posible consultar la base de la Bodega Usado" },
        { status: 502 }
      );
    }
  }

  // Respuesta por artículo: sin llave o sin cruce → 0 piezas y sin precio.
  const porArticulo: Record<number, ResumenUsadas> = {};
  for (const id of ids) {
    const clave = llavePorId.get(id);
    const enCache = clave ? cache.get(clave) : undefined;
    porArticulo[id] = enCache ? enCache.valor : { piezas: 0, desde: null };
  }
  return NextResponse.json({ porArticulo });
}
