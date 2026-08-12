import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el inventario completo

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

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const idLinea = Number(searchParams.get("idLinea")) || 0;
  const idParte = Number(searchParams.get("idParte")) || 0;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Reporte de inventario físico valuado: solo artículos con existencia.
  const condiciones: string[] = ["a.existencia > 0"];
  const params: unknown[] = [];
  if (busqueda) {
    // Código por prefijo (aprovecha índice) o descripción en cualquier posición.
    condiciones.push("(a.codigo LIKE ? OR a.descripcion LIKE ?)");
    params.push(`${busqueda}%`, `%${busqueda}%`);
  }
  if (Number.isInteger(idLinea) && idLinea > 0) {
    condiciones.push("a.id_linea = ?");
    params.push(idLinea);
  }
  if (Number.isInteger(idParte) && idParte > 0) {
    condiciones.push("a.id_parte = ?");
    params.push(idParte);
  }
  const where = condiciones.join(" AND ");
  const offset = (page - 1) * pageSize;

  try {
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
          LIMIT ${offset}, ${pageSize}`,
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

    return NextResponse.json({
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      articulos: filas,
    });
  } catch (error) {
    console.error("Error listando existencias:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las existencias" },
      { status: 502 }
    );
  }
}
