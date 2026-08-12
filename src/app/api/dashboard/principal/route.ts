import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface FilaKpisHoy {
  ventasHoy: number;
  totalHoy: number;
  cotizacionesHoy: number;
}
interface FilaMes {
  mes: string;
  ventas: number;
  total: number;
}
interface FilaInventario {
  codigosConExistencia: number;
  valorInventario: number;
}
interface FilaCartera {
  clientesConSaldo: number;
  cartera: number;
}
interface FilaVentaReciente {
  id: number;
  numVenta: number;
  serie: string | null;
  fecha: string;
  total: number;
  estatus: string | null;
  cliente: string;
}
interface FilaTopArticulo {
  codigo: string;
  descripcion: string;
  piezas: number;
  importe: number;
}

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const [kpisHoy, meses, inventario, cartera, ventasRecientes, topArticulos, pedidosAbiertos] =
      await Promise.all([
        // Un solo escaneo de ventas por fecha (ventas.fecha no tiene índice):
        // COUNT y SUM en la misma pasada, en vez de dos subconsultas.
        consultaBdav<FilaKpisHoy>(`
          SELECT
            (SELECT COUNT(*) FROM cotiza WHERE fecha_cot = CURDATE()) AS cotizacionesHoy,
            v.ventasHoy, v.totalHoy
          FROM (
            SELECT COUNT(*) AS ventasHoy, IFNULL(SUM(total), 0) AS totalHoy
              FROM ventas WHERE fecha = CURDATE()
          ) v
        `),
        consultaBdav<FilaMes>(`
          SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
                 COUNT(*)                    AS ventas,
                 IFNULL(SUM(total), 0)       AS total
            FROM ventas
           WHERE fecha >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
           GROUP BY 1
           ORDER BY 1
        `),
        consultaBdav<FilaInventario>(`
          SELECT COUNT(*)                                   AS codigosConExistencia,
                 IFNULL(SUM(precio_lista * existencia), 0)  AS valorInventario
            FROM articulos
           WHERE existencia > 0
        `),
        consultaBdav<FilaCartera>(`
          SELECT COUNT(*)             AS clientesConSaldo,
                 IFNULL(SUM(saldo), 0) AS cartera
            FROM clientes
           WHERE saldo > 0 AND activo = 1
        `),
        consultaBdav<FilaVentaReciente>(`
          SELECT v.id, v.num_venta AS numVenta, v.serie, v.fecha, IFNULL(v.total, 0) AS total,
                 v.estatus, IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente
            FROM ventas v
            JOIN clientes c ON c.id = v.id_cliente
           ORDER BY v.id DESC
           LIMIT 10
        `),
        consultaBdav<FilaTopArticulo>(`
          SELECT a.codigo, a.descripcion,
                 SUM(d.cantidad)                 AS piezas,
                 IFNULL(SUM(d.total_partida), 0) AS importe
            FROM detalle_venta d
            JOIN ventas v    ON v.id = d.id_venta
            JOIN articulos a ON a.id = d.id_articulo
           WHERE v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           GROUP BY a.id, a.codigo, a.descripcion
           ORDER BY piezas DESC
           LIMIT 10
        `),
        consultaBdav<{ pedidosAbiertos: number }>(`
          SELECT COUNT(*) AS pedidosAbiertos
            FROM pedidos
           WHERE estatus IN ('ABIERTO', 'INCOMPLETO')
        `),
      ]);

    return NextResponse.json({
      hoy: kpisHoy[0] ?? { ventasHoy: 0, totalHoy: 0, cotizacionesHoy: 0 },
      meses,
      inventario: inventario[0] ?? { codigosConExistencia: 0, valorInventario: 0 },
      cartera: cartera[0] ?? { clientesConSaldo: 0, cartera: 0 },
      pedidosAbiertos: pedidosAbiertos[0]?.pedidosAbiertos ?? 0,
      ventasRecientes,
      topArticulos,
    });
  } catch (error) {
    console.error("Error en dashboard principal:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de datos" },
      { status: 502 }
    );
  }
}
