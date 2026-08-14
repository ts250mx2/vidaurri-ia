import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE_DETALLE = 200;

interface FilaGrupo {
  id: number;
  nombre: string;
  importe: number;
  piezas: number;
}
interface FilaDetalle {
  nombre: string;
  descripcion: string;
  importe: number;
  piezas: number;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}
function inicioMesISO(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
}

// SQL por sucursal y agrupación. Matriz = bdav (articulos/partes/lineas);
// Bodega Usado = wwapvi_bd-usadas (piezas/partes/marcas vía modelos).
// La lista devuelve los grupos; el detalle, los productos de un grupo.
function sqlLista(sucursal: "matriz" | "usadas", por: "parte" | "linea"): string {
  if (sucursal === "matriz") {
    const cat =
      por === "linea"
        ? { tabla: "lineas", col: "linea", fk: "id_linea" }
        : { tabla: "partes", col: "parte", fk: "id_parte" };
    return `SELECT c.id AS id, c.${cat.col} AS nombre,
                   ROUND(IFNULL(SUM(dv.total_partida), 0)) AS importe,
                   IFNULL(SUM(dv.cantidad), 0) AS piezas
              FROM detalle_venta dv
              JOIN ventas v      ON v.id = dv.id_venta
              JOIN articulos a   ON a.id = dv.id_articulo
              JOIN ${cat.tabla} c ON c.id = a.${cat.fk}
             WHERE v.fecha BETWEEN ? AND ?
             GROUP BY c.id, c.${cat.col}
            HAVING importe > 0
             ORDER BY importe DESC`;
  }
  // Bodega Usado
  if (por === "linea") {
    return `SELECT ma.id_marca AS id, ma.marca AS nombre,
                   ROUND(IFNULL(SUM(vd.total_item), 0)) AS importe,
                   IFNULL(SUM(vd.cantidad), 0) AS piezas
              FROM venta_detalle vd
              JOIN ventas v   ON v.id_venta = vd.id_venta
              JOIN piezas pz  ON pz.id_pieza = vd.id_pieza
              JOIN modelos mo ON mo.id_modelo = pz.id_modelo
              JOIN marcas ma  ON ma.id_marca = mo.id_marca
             WHERE v.fecha BETWEEN ? AND ?
             GROUP BY ma.id_marca, ma.marca
            HAVING importe > 0
             ORDER BY importe DESC`;
  }
  return `SELECT p.id_parte AS id, p.parte AS nombre,
                 ROUND(IFNULL(SUM(vd.total_item), 0)) AS importe,
                 IFNULL(SUM(vd.cantidad), 0) AS piezas
            FROM venta_detalle vd
            JOIN ventas v  ON v.id_venta = vd.id_venta
            JOIN piezas pz ON pz.id_pieza = vd.id_pieza
            JOIN partes p  ON p.id_parte = pz.id_parte
           WHERE v.fecha BETWEEN ? AND ?
           GROUP BY p.id_parte, p.parte
          HAVING importe > 0
           ORDER BY importe DESC`;
}

function sqlDetalle(sucursal: "matriz" | "usadas", por: "parte" | "linea"): string {
  if (sucursal === "matriz") {
    const fk = por === "linea" ? "id_linea" : "id_parte";
    return `SELECT a.codigo AS nombre, a.descripcion AS descripcion,
                   ROUND(IFNULL(SUM(dv.total_partida), 0)) AS importe,
                   IFNULL(SUM(dv.cantidad), 0) AS piezas
              FROM detalle_venta dv
              JOIN ventas v    ON v.id = dv.id_venta
              JOIN articulos a ON a.id = dv.id_articulo
             WHERE v.fecha BETWEEN ? AND ? AND a.${fk} = ?
             GROUP BY a.id, a.codigo, a.descripcion
            HAVING importe > 0
             ORDER BY importe DESC
             LIMIT ${LIMITE_DETALLE}`;
  }
  if (por === "linea") {
    return `SELECT pz.codigo AS nombre, pz.descripcion AS descripcion,
                   ROUND(IFNULL(SUM(vd.total_item), 0)) AS importe,
                   IFNULL(SUM(vd.cantidad), 0) AS piezas
              FROM venta_detalle vd
              JOIN ventas v   ON v.id_venta = vd.id_venta
              JOIN piezas pz  ON pz.id_pieza = vd.id_pieza
              JOIN modelos mo ON mo.id_modelo = pz.id_modelo
             WHERE v.fecha BETWEEN ? AND ? AND mo.id_marca = ?
             GROUP BY pz.id_pieza, pz.codigo, pz.descripcion
            HAVING importe > 0
             ORDER BY importe DESC
             LIMIT ${LIMITE_DETALLE}`;
  }
  return `SELECT pz.codigo AS nombre, pz.descripcion AS descripcion,
                 ROUND(IFNULL(SUM(vd.total_item), 0)) AS importe,
                 IFNULL(SUM(vd.cantidad), 0) AS piezas
            FROM venta_detalle vd
            JOIN ventas v  ON v.id_venta = vd.id_venta
            JOIN piezas pz ON pz.id_pieza = vd.id_pieza
           WHERE v.fecha BETWEEN ? AND ? AND pz.id_parte = ?
           GROUP BY pz.id_pieza, pz.codigo, pz.descripcion
          HAVING importe > 0
           ORDER BY importe DESC
           LIMIT ${LIMITE_DETALLE}`;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const por = searchParams.get("por") === "linea" ? "linea" : "parte";
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const fechaInicio = ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
    ? searchParams.get("fechaInicio")!
    : inicioMesISO();
  const fechaFin = ES_FECHA.test(searchParams.get("fechaFin") ?? "")
    ? searchParams.get("fechaFin")!
    : hoyISO();
  const idParam = searchParams.get("id");
  const id = idParam != null ? Number(idParam) : null;

  const ejecutar: <T>(sql: string, params?: unknown[]) => Promise<T[]> =
    sucursal === "usadas" ? consultaUsadas : consultaBdav;

  try {
    // Modo DETALLE: productos de un grupo (parte o línea) concreto.
    if (id != null) {
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Grupo inválido" }, { status: 400 });
      }
      const detalle = await ejecutar<FilaDetalle>(sqlDetalle(sucursal, por), [
        fechaInicio,
        fechaFin,
        id,
      ]);
      const totalImporte = detalle.reduce((s, f) => s + f.importe, 0);
      const totalPiezas = detalle.reduce((s, f) => s + f.piezas, 0);
      return NextResponse.json({ por, sucursal, fechaInicio, fechaFin, totalImporte, totalPiezas, detalle });
    }

    // Modo LISTA: grupos.
    const filas = await ejecutar<FilaGrupo>(sqlLista(sucursal, por), [fechaInicio, fechaFin]);
    const totalImporte = filas.reduce((s, f) => s + f.importe, 0);
    const totalPiezas = filas.reduce((s, f) => s + f.piezas, 0);
    return NextResponse.json({ por, sucursal, fechaInicio, fechaFin, totalImporte, totalPiezas, grupos: filas });
  } catch (error) {
    console.error("Error en desglose de ventas:", error);
    const mensaje =
      sucursal === "usadas"
        ? "No fue posible consultar la base de la Bodega Usado"
        : "No fue posible consultar el desglose de ventas";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
