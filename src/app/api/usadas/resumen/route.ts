import { NextResponse } from "next/server";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

// Resumen operativo de la BODEGA USADO (sucursal de piezas usadas, base remota
// wwapvi_bd-usadas): KPIs del día, ventas por mes, valor del inventario, últimas
// ventas, piezas más vendidas del mes e inventario por tipo de parte. Lo consume
// el Panel Principal cuando el selector de sucursal está en "Bodega Usado".

export const dynamic = "force-dynamic";

interface FilaHoy {
  ventasHoy: number;
  totalHoy: number;
}
interface FilaMes {
  mes: string;
  ventas: number;
  total: number;
}
interface FilaInventario {
  piezasConExistencia: number;
  valorInventario: number;
}
interface FilaPorCobrar {
  ventasConSaldo: number;
  porCobrar: number;
}
interface FilaVentaReciente {
  id: number;
  numVenta: number;
  fecha: string;
  total: number;
  saldo: number;
  estatus: string | null;
  cliente: string | null;
}
interface FilaTopPieza {
  codigo: string;
  descripcion: string;
  piezas: number;
  importe: number;
}
interface FilaParte {
  parte: string;
  piezas: number;
  valor: number;
}

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const [hoy, meses, inventario, porCobrar, ventasRecientes, topPiezas, inventarioPorParte] =
      await Promise.all([
        consultaUsadas<FilaHoy>(`
          SELECT COUNT(*) AS ventasHoy, IFNULL(SUM(total), 0) AS totalHoy
            FROM ventas
           WHERE fecha = CURDATE()
        `),
        consultaUsadas<FilaMes>(`
          SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
                 COUNT(*)                    AS ventas,
                 IFNULL(SUM(total), 0)       AS total
            FROM ventas
           WHERE fecha >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
           GROUP BY 1
           ORDER BY 1
        `),
        consultaUsadas<FilaInventario>(`
          SELECT COUNT(*)                              AS piezasConExistencia,
                 IFNULL(SUM(precio * existencia), 0)   AS valorInventario
            FROM piezas
           WHERE existencia > 0
        `),
        consultaUsadas<FilaPorCobrar>(`
          SELECT COUNT(*)              AS ventasConSaldo,
                 IFNULL(SUM(saldo), 0) AS porCobrar
            FROM ventas
           WHERE saldo > 0
        `),
        consultaUsadas<FilaVentaReciente>(`
          SELECT id_venta AS id, num_venta AS numVenta, fecha,
                 IFNULL(total, 0) AS total, IFNULL(saldo, 0) AS saldo,
                 estatus, NULLIF(nombre_cliente, '') AS cliente
            FROM ventas
           ORDER BY id_venta DESC
           LIMIT 10
        `),
        consultaUsadas<FilaTopPieza>(`
          SELECT p.codigo, p.descripcion,
                 SUM(d.cantidad)               AS piezas,
                 IFNULL(SUM(d.total_item), 0)  AS importe
            FROM venta_detalle d
            JOIN ventas v ON v.id_venta = d.id_venta
            JOIN piezas p ON p.id_pieza = d.id_pieza
           WHERE v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           GROUP BY p.id_pieza, p.codigo, p.descripcion
           ORDER BY piezas DESC, importe DESC
           LIMIT 10
        `),
        consultaUsadas<FilaParte>(`
          SELECT IFNULL(pa.parte, 'SIN TIPO')          AS parte,
                 COUNT(*)                              AS piezas,
                 IFNULL(SUM(p.precio * p.existencia), 0) AS valor
            FROM piezas p
            LEFT JOIN partes pa ON pa.id_parte = p.id_parte
           WHERE p.existencia > 0
           GROUP BY pa.id_parte, pa.parte
           ORDER BY valor DESC
        `),
      ]);

    return NextResponse.json({
      hoy: hoy[0] ?? { ventasHoy: 0, totalHoy: 0 },
      meses,
      inventario: inventario[0] ?? { piezasConExistencia: 0, valorInventario: 0 },
      porCobrar: porCobrar[0] ?? { ventasConSaldo: 0, porCobrar: 0 },
      ventasRecientes,
      topPiezas,
      inventarioPorParte,
    });
  } catch (error) {
    console.error("Error en resumen de la Bodega Usado:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de la Bodega Usado" },
      { status: 502 }
    );
  }
}
